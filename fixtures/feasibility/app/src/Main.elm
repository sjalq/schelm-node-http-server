port module Main exposing (main)

import Json.Encode as Encode
import Platform
import Probe.Server as Server


port report : Encode.Value -> Cmd msg


type alias Model =
    { listener : Maybe Server.Listener
    , requestCount : Int
    }


type Msg
    = Listening (Result String Server.Listener)
    | GotRequest Server.Request Server.Response
    | Responded (Result String ())
    | Closed (Result String ())


type alias Flags =
    { port_ : Int }


main : Program Flags Model Msg
main =
    Platform.worker
        { init = \flags -> ( { listener = Nothing, requestCount = 0 }, Server.listen flags.port_ Listening )
        , update = update
        , subscriptions = subscriptions
        }


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.listener of
        Nothing ->
            Sub.none

        Just listener ->
            Server.onRequest listener GotRequest


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Listening result ->
            case result of
                Ok listener ->
                    ( { model | listener = Just listener }
                    , report (event "listening" True)
                    )

                Err _ ->
                    ( model, report (event "listen-error" False) )

        GotRequest _ response ->
            ( { model | requestCount = model.requestCount + 1 }
            , Cmd.batch
                [ report (event "request" True)
                , Server.respond response "0123456789abcdef" Responded
                ]
            )

        Responded result ->
            case model.listener of
                Nothing ->
                    ( model, report (event "missing-listener" False) )

                Just listener ->
                    ( model
                    , Server.close listener Closed
                    )

        Closed result ->
            ( { model | listener = Nothing }
            , report
                (Encode.object
                    [ ( "event", Encode.string "closed" )
                    , ( "ok"
                      , Encode.bool
                            (case result of
                                Ok _ ->
                                    True

                                Err _ ->
                                    False
                            )
                      )
                    , ( "requests", Encode.int model.requestCount )
                    ]
                )
            )


event : String -> Bool -> Encode.Value
event name ok =
    Encode.object [ ( "event", Encode.string name ), ( "ok", Encode.bool ok ) ]
