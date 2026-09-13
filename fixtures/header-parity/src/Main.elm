port module Main exposing (main)

import Json.Encode as Encode
import Platform
import Schelm.Node.HttpServer as Server


port report : Encode.Value -> Cmd msg


type Msg
    = Started Server.Operation
    | Listening Server.Operation (Result Server.ListenError Server.Listener)
    | Http Server.Event
    | Sent (Result Server.WriteError Server.ResponseResult)
    | Closed (Result Server.CloseError Server.CloseReport)


type alias Model =
    { listener : Maybe Server.Listener }


main : Program () Model Msg
main =
    Platform.worker
        { init = \_ -> ( { listener = Nothing }, Server.listen Server.initialize (Server.loopback Server.ephemeralPort) Server.defaults { onStarted = Started, onFinished = Listening } )
        , update = update
        , subscriptions = subscriptions
        }


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.listener of
        Just listener ->
            Server.onEvents (Server.eventRoute listener 1) Http

        Nothing ->
            Sub.none


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Started _ ->
            ( model, Cmd.none )

        Listening _ result ->
            case result of
                Ok listener ->
                    ( { listener = Just listener }
                    , report
                        (Encode.object
                            [ ( "kind", Encode.string "listening" )
                            , ( "port", Encode.int (Server.endpoint listener).port_ )
                            ]
                        )
                    )

                Err error ->
                    ( model, report (Encode.object [ ( "kind", Encode.string "listen-error" ), ( "message", Encode.string (Server.listenErrorMessage error) ) ]) )

        Http event ->
            case event of
                Server.RequestOffered _ _ _ response ->
                    ( model, Server.send response responsePlan Sent )

                _ ->
                    ( model, Cmd.none )

        Sent result ->
            let
                outcome =
                    case result of
                        Ok Server.AcceptedByNode ->
                            "accepted"

                        Ok Server.ResponsePeerClosed ->
                            "peer-closed"

                        Ok Server.ResponseTimedOut ->
                            "timed-out"

                        Err _ ->
                            "write-error"
            in
            case model.listener of
                Just listener ->
                    ( model
                    , Cmd.batch
                        [ report (Encode.object [ ( "kind", Encode.string "sent" ), ( "outcome", Encode.string outcome ) ])
                        , Server.close listener Server.graceful Closed
                        ]
                    )

                Nothing ->
                    ( model, report (Encode.object [ ( "kind", Encode.string "sent" ), ( "outcome", Encode.string outcome ) ]) )

        Closed _ ->
            ( { listener = Nothing }, report (Encode.object [ ( "kind", Encode.string "closed" ) ]) )


responsePlan : Server.ResponsePlan
responsePlan =
    case ( Server.status 200, Server.responseHeader "content-type" "text/plain; charset=utf-8", Server.responseHeader "x-schelm-gate" "optimize-parity" ) of
        ( Ok status, Ok contentType, Ok gate ) ->
            Server.respond status [ contentType, gate ] (Server.utf8Body "hello")

        _ ->
            Server.text 500 "header-construction-failed"
