port module M0cWorker exposing (main)

import Json.Encode as E
import Platform
import Probe.M0c as M0c


port report : E.Value -> Cmd msg


type Msg
    = BindStarted M0c.Operation
    | BindFinished M0c.Operation (Result String M0c.Listener)
    | Nested NestedMsg
    | EventA String
    | EventB String


type NestedMsg
    = WriteFinished M0c.ResultFacts
    | UpgradeFinished String M0c.ResultFacts


type alias Model =
    { operation : Maybe M0c.Operation, routeStep : Int }


main : Program () Model Msg
main =
    Platform.worker { init = \_ -> ( { operation = Nothing, routeStep = 0 }, M0c.beginBind { onStarted = BindStarted, onFinished = BindFinished } ), update = update, subscriptions = subscriptions }


subscriptions model =
    case model.routeStep of
        0 ->
            M0c.onEvents M0c.testListener EventA

        1 ->
            M0c.onEvents M0c.testListener EventB

        2 ->
            Sub.batch [ M0c.onEvents M0c.testListener EventA, M0c.onEvents M0c.testListener EventB ]

        _ ->
            Sub.none


update msg model =
    case msg of
        BindStarted operation ->
            ( { model | operation = Just operation }
            , Cmd.batch
                [ report (event "bind-started" "")
                , M0c.cancel operation
                , M0c.cancel operation
                , M0c.runWrite M0c.FalseDrain WriteFinished |> Cmd.map Nested
                , M0c.runWrite M0c.ErrorAfterFalse WriteFinished |> Cmd.map Nested
                , M0c.runWrite M0c.CloseAfterFalse WriteFinished |> Cmd.map Nested
                , M0c.runUpgrade M0c.Transfer (UpgradeFinished "transfer") |> Cmd.map Nested
                , M0c.runUpgrade M0c.Reject (UpgradeFinished "reject") |> Cmd.map Nested
                , M0c.runUpgrade M0c.Timeout (UpgradeFinished "timeout") |> Cmd.map Nested
                , M0c.runUpgrade M0c.Throw (UpgradeFinished "throw") |> Cmd.map Nested
                , M0c.emit M0c.testListener "stable-a"
                ]
            )

        BindFinished _ result ->
            let
                detail =
                    case result of
                        Err reason ->
                            reason

                        Ok _ ->
                            "unexpected-ok"
            in
            ( { model | routeStep = 1 }
            , Cmd.batch [ report (event "bind-finished" detail), M0c.emit M0c.testListener "stable-b" ]
            )

        Nested nested ->
            case nested of
                WriteFinished facts ->
                    ( model, report (event facts.kind facts.detail) )

                UpgradeFinished label facts ->
                    ( model, report (event ("upgrade-" ++ label ++ ":" ++ facts.kind) facts.detail) )

        EventA value ->
            ( { model | routeStep = 2 }, Cmd.batch [ report (event "route-a" value), M0c.emit M0c.testListener "ambiguous-drop" ] )

        EventB value ->
            ( { model | routeStep = 3 }, Cmd.batch [ report (event "route-b" value), M0c.emit M0c.testListener "absent-drop" ] )


event kind detail =
    E.object [ ( "kind", E.string kind ), ( "detail", E.string detail ) ]
