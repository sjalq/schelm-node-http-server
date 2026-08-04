port module Main exposing (main)

import Json.Encode as Encode
import Platform
import Schelm.Node.HttpServer as Server

port report : Encode.Value -> Cmd msg

type Msg
    = Started Server.Operation
    | Listening Server.Operation (Result Server.ListenError Server.Listener)
    | Http Server.Event
    | Discarded (Result Server.BodyError ())
    | Sent (Result Server.WriteError Server.ResponseResult)
    | Closed (Result Server.CloseError Server.CloseReport)

type alias Model = { listener : Maybe Server.Listener }

main : Program () Model Msg
main = Platform.worker { init = \_ -> ( { listener = Nothing }, Server.listen Server.initialize (Server.loopback Server.ephemeralPort) Server.defaults { onStarted = Started, onFinished = Listening } ), update = update, subscriptions = subscriptions }

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
                Server.RequestOffered _ _ body response -> ( model, Cmd.batch [ Server.discardBody body Discarded, Server.send response (Server.text 200 "ok") Sent ] )
                _ -> ( model, Cmd.none )
        Discarded _ -> ( model, Cmd.none )
        Sent _ ->
            case model.listener of
                Just listener -> ( model, Server.close listener Server.graceful Closed )
                Nothing -> ( model, Cmd.none )
        Closed _ -> ( { model | listener = Nothing }, report (Encode.string "closed") )

