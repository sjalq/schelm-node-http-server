effect module Probe.Server where { command = MyCmd, subscription = MySub } exposing (Listener, Request, Response, close, listen, onRequest, respond)

import Elm.Kernel.ServerProbe
import Platform
import Platform.Cmd exposing (Cmd)
import Platform.Sub exposing (Sub)
import Task exposing (Task)


type Listener
    = Listener Int


type Request
    = Request Int String


type Response
    = Response Int


type MyCmd msg
    = Listen Int (Result String Listener -> msg)
    | Respond Response String (Result String () -> msg)
    | Close Listener (Result String () -> msg)


type MySub msg
    = Requests Listener (Request -> Response -> msg)


type SelfMsg
    = NoSelfMsg


type alias State =
    ()


type alias MyRouter msg =
    Platform.Router msg SelfMsg


listen : Int -> (Result String Listener -> msg) -> Cmd msg
listen port_ tagger =
    command (Listen port_ tagger)


respond : Response -> String -> (Result String () -> msg) -> Cmd msg
respond response body tagger =
    command (Respond response body tagger)


close : Listener -> (Result String () -> msg) -> Cmd msg
close listener tagger =
    command (Close listener tagger)


onRequest : Listener -> (Request -> Response -> msg) -> Sub msg
onRequest listener tagger =
    subscription (Requests listener tagger)


cmdMap : (a -> b) -> MyCmd a -> MyCmd b
cmdMap f cmd =
    case cmd of
        Listen port_ tagger ->
            Listen port_ (tagger >> f)

        Respond response body tagger ->
            Respond response body (tagger >> f)

        Close listener tagger ->
            Close listener (tagger >> f)


subMap : (a -> b) -> MySub a -> MySub b
subMap f (Requests listener tagger) =
    Requests listener (\request response -> f (tagger request response))


init : Task Never State
init =
    Task.succeed ()


onEffects : MyRouter msg -> List (MyCmd msg) -> List (MySub msg) -> State -> Task Never State
onEffects router cmds subs state =
    Elm.Kernel.ServerProbe.reconcile router (List.map subFacts subs)
        |> Task.andThen (\_ -> runCommands router cmds)
        |> Task.andThen (\_ -> Task.succeed state)


runCommands : MyRouter msg -> List (MyCmd msg) -> Task Never ()
runCommands router cmds =
    case cmds of
        [] ->
            Task.succeed ()

        cmd :: rest ->
            runCommand router cmd |> Task.andThen (\_ -> runCommands router rest)


runCommand : MyRouter msg -> MyCmd msg -> Task Never ()
runCommand router cmd =
    case cmd of
        Listen port_ tagger ->
            Elm.Kernel.ServerProbe.listen router port_ Listener Request Response
                |> Task.map (Result.mapError identity)
                |> Task.andThen (tagger >> Platform.sendToApp router)

        Respond response body tagger ->
            Elm.Kernel.ServerProbe.respond (responseId response) body
                |> Task.andThen (tagger >> Platform.sendToApp router)

        Close listener tagger ->
            Elm.Kernel.ServerProbe.close (listenerId listener)
                |> Task.andThen (tagger >> Platform.sendToApp router)


onSelfMsg : MyRouter msg -> SelfMsg -> State -> Task Never State
onSelfMsg _ _ state =
    Task.succeed state


listenerId : Listener -> Int
listenerId (Listener value) =
    value


responseId : Response -> Int
responseId (Response value) =
    value


subFacts : MySub msg -> ( Int, Request -> Response -> msg )
subFacts (Requests listener tagger) =
    ( listenerId listener, tagger )
