port module Main exposing (main)

import Json.Encode as Encode
import Platform
import Schelm.Node.HttpServer as Server

port report : Encode.Value -> Cmd msg

type Msg
    = Started Server.Operation
    | Listening Server.Operation (Result Server.ListenError Server.Listener)
    | Http Server.Event
    | BodyRead Server.BodyEvent
    | Sent (Result Server.WriteError Server.ResponseResult)
    | Closed (Result Server.CloseError Server.CloseReport)

type alias Model = { listener : Maybe Server.Listener }

main : Program () Model Msg
main =
    Platform.worker
        { init = \_ ->
            let
                options =
                    Server.withBodyTimeout 100 Server.defaults
                        |> Result.withDefault Server.defaults
            in
            ( { listener = Nothing }, Server.listen Server.initialize (Server.loopback Server.ephemeralPort) options { onStarted = Started, onFinished = Listening } ), update = update, subscriptions = subscriptions }

subscriptions model =
    case model.listener of
        Just listener -> Server.onEvents (Server.eventRoute listener 1) Http
        Nothing -> Sub.none

update msg model =
    case msg of
        Started _ -> ( model, report (Encode.string "started") )
        Listening _ result ->
            case result of
                Ok listener -> ( { listener = Just listener }, report (Encode.object [ ( "kind", Encode.string "listening" ), ( "port", Encode.int (Server.endpoint listener).port_ ) ]) )
                Err error -> ( model, report (Encode.string (Server.listenErrorMessage error)) )
        Http event ->
            case event of
                Server.RequestOffered _ _ _ response ->
                    ( model, Cmd.batch [ report (Encode.string "initial-body-paused"), Server.send response (Server.text 200 "ok") Sent ] )
                _ -> ( model, Cmd.none )
        BodyRead event ->
            case event of
                Server.BodyChunk _ _ -> ( model, report (Encode.string "chunk-paused") )
                _ -> ( model, Cmd.none )
        Sent _ ->
            case model.listener of
                Just listener -> ( model, Server.close listener Server.graceful Closed )
                Nothing -> ( model, Cmd.none )
        Closed _ -> ( { model | listener = Nothing }, report (Encode.string "closed") )

