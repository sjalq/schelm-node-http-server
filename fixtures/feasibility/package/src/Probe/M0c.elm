effect module Probe.M0c where { command = MyCmd, subscription = MySub } exposing
    ( BindCallbacks
    , Listener
    , Operation
    , ResultFacts
    , RouteMode(..)
    , UpgradeCase(..)
    , WriteScript(..)
    , beginBind
    , cancel
    , emit
    , onEvents
    , runUpgrade
    , runWrite
    , testListener
    )

import Dict exposing (Dict)
import Elm.Kernel.M0cProbe
import Platform
import Platform.Cmd exposing (Cmd)
import Platform.Sub exposing (Sub)
import Task exposing (Task)


type Operation
    = Operation Int


type Listener
    = Listener Int


type alias BindCallbacks msg =
    { onStarted : Operation -> msg
    , onFinished : Operation -> Result String Listener -> msg
    }


type WriteScript
    = FalseDrain
    | ErrorAfterFalse
    | CloseAfterFalse


type UpgradeCase
    = Transfer
    | Reject
    | Timeout
    | Throw


type alias ResultFacts =
    { kind : String, detail : String }


type RouteMode
    = RoutePresent
    | RouteAbsent
    | RouteAmbiguous


type MyCmd msg
    = BeginBind (BindCallbacks msg)
    | Cancel Operation
    | RunWrite WriteScript (ResultFacts -> msg)
    | RunUpgrade UpgradeCase (ResultFacts -> msg)
    | Emit Listener String


type MySub msg
    = Events Listener (String -> msg)


type Reply msg
    = BindReply (Operation -> Result String Listener -> msg)
    | FactsReply (ResultFacts -> msg)


type alias Route msg =
    { generation : Int
    , ownership : RouteMode
    , tagger : Maybe (String -> msg)
    }


type alias State msg =
    { next : Int
    , replies : Dict Int (Reply msg)
    , routes : Dict Int (Route msg)
    }


type SelfMsg
    = BindDone Int Bool String Int
    | FactsDone Int String String
    | Incoming Int Int String


type alias MyRouter msg =
    Platform.Router msg SelfMsg


testListener : Listener
testListener =
    Listener 99


beginBind : BindCallbacks msg -> Cmd msg
beginBind callbacks =
    command (BeginBind callbacks)


cancel : Operation -> Cmd msg
cancel operation =
    command (Cancel operation)


runWrite : WriteScript -> (ResultFacts -> msg) -> Cmd msg
runWrite script tagger =
    command (RunWrite script tagger)


runUpgrade : UpgradeCase -> (ResultFacts -> msg) -> Cmd msg
runUpgrade scenario tagger =
    command (RunUpgrade scenario tagger)


emit : Listener -> String -> Cmd msg
emit listener value =
    command (Emit listener value)


onEvents : Listener -> (String -> msg) -> Sub msg
onEvents listener tagger =
    subscription (Events listener tagger)


cmdMap : (a -> b) -> MyCmd a -> MyCmd b
cmdMap f command_ =
    case command_ of
        BeginBind callbacks ->
            BeginBind { onStarted = callbacks.onStarted >> f, onFinished = \op result -> f (callbacks.onFinished op result) }

        Cancel operation ->
            Cancel operation

        RunWrite script tagger ->
            RunWrite script (tagger >> f)

        RunUpgrade scenario tagger ->
            RunUpgrade scenario (tagger >> f)

        Emit listener value ->
            Emit listener value


subMap : (a -> b) -> MySub a -> MySub b
subMap f (Events listener tagger) =
    Events listener (tagger >> f)


init : Task Never (State msg)
init =
    Task.succeed { next = 1, replies = Dict.empty, routes = Dict.empty }


onEffects : MyRouter msg -> List (MyCmd msg) -> List (MySub msg) -> State msg -> Task Never (State msg)
onEffects router commands subscriptions state =
    let
        routed =
            reconcile subscriptions state
    in
    dispatchAll router commands routed


reconcile : List (MySub msg) -> State msg -> State msg
reconcile subscriptions state =
    let
        grouped =
            List.foldl addSubscription Dict.empty subscriptions

        ids =
            Dict.foldl (\id _ acc -> Dict.insert id () acc) (Dict.map (\_ _ -> ()) state.routes) grouped

        routes =
            Dict.foldl (reconcileOne grouped state.routes) Dict.empty ids
    in
    { state | routes = routes }


addSubscription : MySub msg -> Dict Int (List (String -> msg)) -> Dict Int (List (String -> msg))
addSubscription (Events (Listener id) tagger) =
    Dict.update id (\found -> Just (tagger :: Maybe.withDefault [] found))


reconcileOne : Dict Int (List (String -> msg)) -> Dict Int (Route msg) -> Int -> () -> Dict Int (Route msg) -> Dict Int (Route msg)
reconcileOne grouped old id _ acc =
    let
        previous =
            Dict.get id old

        priorGeneration =
            previous |> Maybe.map .generation |> Maybe.withDefault 0

        previousPresent =
            previous |> Maybe.map (\r -> r.ownership == RoutePresent) |> Maybe.withDefault False
    in
    case Dict.get id grouped of
        Just [ tagger ] ->
            Dict.insert id
                { generation =
                    if previousPresent then
                        priorGeneration

                    else
                        priorGeneration + 1
                , ownership = RoutePresent
                , tagger = Just tagger
                }
                acc

        Just (_ :: _ :: _) ->
            Dict.insert id { generation = priorGeneration + 1, ownership = RouteAmbiguous, tagger = Nothing } acc

        _ ->
            case previous of
                Nothing ->
                    acc

                Just _ ->
                    Dict.insert id { generation = priorGeneration + 1, ownership = RouteAbsent, tagger = Nothing } acc


dispatchAll : MyRouter msg -> List (MyCmd msg) -> State msg -> Task Never (State msg)
dispatchAll router commands state =
    case commands of
        [] ->
            Task.succeed state

        first :: rest ->
            dispatch router first state |> Task.andThen (dispatchAll router rest)


dispatch : MyRouter msg -> MyCmd msg -> State msg -> Task Never (State msg)
dispatch router command_ state =
    case command_ of
        BeginBind callbacks ->
            let
                id =
                    state.next

                operation =
                    Operation id

                next =
                    { state | next = id + 1, replies = Dict.insert id (BindReply callbacks.onFinished) state.replies }
            in
            Elm.Kernel.M0cProbe.beginBind router id BindDone
                |> Task.andThen (\_ -> Platform.sendToApp router (callbacks.onStarted operation))
                |> Task.andThen (\_ -> Task.succeed next)

        Cancel (Operation id) ->
            Elm.Kernel.M0cProbe.cancelBind id |> Task.andThen (\_ -> Task.succeed state)

        RunWrite script tagger ->
            let
                id =
                    state.next

                next =
                    { state | next = id + 1, replies = Dict.insert id (FactsReply tagger) state.replies }
            in
            Elm.Kernel.M0cProbe.runWrite router id (writeName script) FactsDone |> Task.andThen (\_ -> Task.succeed next)

        RunUpgrade scenario tagger ->
            let
                id =
                    state.next

                next =
                    { state | next = id + 1, replies = Dict.insert id (FactsReply tagger) state.replies }
            in
            Elm.Kernel.M0cProbe.runUpgrade router id (upgradeName scenario) FactsDone |> Task.andThen (\_ -> Task.succeed next)

        Emit (Listener listenerId_) value ->
            case Dict.get listenerId_ state.routes of
                Just route ->
                    Elm.Kernel.M0cProbe.emit router listenerId_ route.generation value Incoming |> Task.andThen (\_ -> Task.succeed state)

                Nothing ->
                    Task.succeed state


onSelfMsg : MyRouter msg -> SelfMsg -> State msg -> Task Never (State msg)
onSelfMsg router self state =
    case self of
        BindDone id ok detail listenerId_ ->
            case Dict.get id state.replies of
                Just (BindReply tagger) ->
                    let
                        result =
                            if ok then
                                Ok (Listener listenerId_)

                            else
                                Err detail

                        next =
                            { state | replies = Dict.remove id state.replies }
                    in
                    Platform.sendToApp router (tagger (Operation id) result) |> Task.andThen (\_ -> Task.succeed next)

                _ ->
                    Task.succeed state

        FactsDone id kind detail ->
            case Dict.get id state.replies of
                Just (FactsReply tagger) ->
                    let
                        next =
                            { state | replies = Dict.remove id state.replies }
                    in
                    Platform.sendToApp router (tagger { kind = kind, detail = detail }) |> Task.andThen (\_ -> Task.succeed next)

                _ ->
                    Task.succeed state

        Incoming listenerId_ generation value ->
            case Dict.get listenerId_ state.routes of
                Just route ->
                    case ( route.ownership, route.tagger ) of
                        ( RoutePresent, Just tagger ) ->
                            if route.generation == generation then
                                Platform.sendToApp router (tagger value) |> Task.andThen (\_ -> Task.succeed state)

                            else
                                Task.succeed state

                        _ ->
                            Task.succeed state

                Nothing ->
                    Task.succeed state


writeName : WriteScript -> String
writeName script =
    case script of
        FalseDrain ->
            "false-drain"

        ErrorAfterFalse ->
            "error"

        CloseAfterFalse ->
            "close"


upgradeName : UpgradeCase -> String
upgradeName scenario =
    case scenario of
        Transfer ->
            "transfer"

        Reject ->
            "reject"

        Timeout ->
            "timeout"

        Throw ->
            "throw"
