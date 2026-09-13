effect module Schelm.Node.HttpServer where { command = MyCmd, subscription = MySub } exposing
    ( Permission, initialize
    , Port, BindError(..), tcpPort, ephemeralPort, SocketPath, unixSocket, Bind, loopback, public, unix, PublicAcknowledgement, acknowledgePublicExposure
    , Options, defaults, Limits, limits, LimitError(..), withLimits, withHeadersTimeout, withRequestTimeout, withDecisionTimeout, withBodyTimeout, withWriteTimeout, withFinishTimeout, withKeepAliveTimeout, withUpgradeTimeout, withGracefulTimeout
    , Operation, Listener, Endpoint, endpoint
    , ListenError, ListenErrorKind(..), listenErrorKind, listenErrorMessage, ListenCallbacks, listen, cancelListen
    , Event(..), EventRoute, eventRoute, onEvents, Request, RequestId, requestId, method, target, TargetForm(..), targetForm, httpVersion, Header, headerName, headerValue, headers, headerValues, remoteAddress, encrypted
    , BodyReader, BodyLimit, bodyLimit, BodyEvent(..), BodyError(..), readBody, discardBody
    , Response, Status, StatusError(..), status, HeaderError(..), responseHeader, Body, emptyBody, utf8Body, bytesBody, ResponsePlan, respond, text, bytes, StreamingPlan, streaming, stream
    , Writer, WriteResult(..), WriteError(..), write, end
    , ResponseResult(..), AbortReason(..), abort
    , Upgrade, TransferResult(..), transferRequest, transferUpgrade, UpgradeDecision(..), rejectUpgrade
    , ClosePlan, graceful, withCloseDeadline, CloseReport, CloseError(..), close
    , send
    )

{-| Bounded cooperative HTTP/1.1 servers for Node.js.

The core lifecycle is `listen -> events/commands -> close`. Incoming bodies are
paused and only one chunk is copied for each `readBody`. Streaming responses
retain one write until Node accepts it or `drain` fires. Every waiting state has
a configured deadline and every listener has admission budgets.

A `Listener`, `BodyReader`, `Response`, or `Writer` is a cooperative ownership
token, not a security capability. `finish` is reported as `AcceptedByNode` on
the `send`/`end` command result, not as an unsolicited `Event` and not as peer
delivery. Public exposure is explicit. Node host objects and raw upgrade
sockets never cross this API.

@docs Permission, initialize
@docs Port, BindError, tcpPort, ephemeralPort, SocketPath, unixSocket, Bind, loopback, public, unix, PublicAcknowledgement, acknowledgePublicExposure
@docs Options, defaults, Limits, limits, LimitError, withLimits, withHeadersTimeout, withRequestTimeout, withDecisionTimeout, withBodyTimeout, withWriteTimeout, withFinishTimeout, withKeepAliveTimeout, withUpgradeTimeout, withGracefulTimeout
@docs Operation, Listener, Endpoint, endpoint
@docs ListenError, ListenErrorKind, listenErrorKind, listenErrorMessage, ListenCallbacks, listen, cancelListen
@docs Event, EventRoute, eventRoute, onEvents, Request, RequestId, requestId, method, target, TargetForm, targetForm, httpVersion, Header, headerName, headerValue, headers, headerValues, remoteAddress, encrypted
@docs BodyReader, BodyLimit, bodyLimit, BodyEvent, BodyError, readBody, discardBody
@docs Response, Status, StatusError, status, HeaderError, responseHeader, Body, emptyBody, utf8Body, bytesBody, ResponsePlan, respond, text, bytes, StreamingPlan, streaming, stream
@docs Writer, WriteResult, WriteError, write, end
@docs ResponseResult, AbortReason, abort
@docs Upgrade, TransferResult, transferRequest, transferUpgrade, UpgradeDecision, rejectUpgrade
@docs ClosePlan, graceful, withCloseDeadline, CloseReport, CloseError, close

-}

import Bytes exposing (Bytes)
import Bytes.Encode as BytesEncode
import Dict exposing (Dict)
import Elm.Kernel.HttpServer
import Platform
import Platform.Cmd exposing (Cmd)
import Platform.Sub exposing (Sub)
import Task exposing (Task)


type Permission
    = Permission


initialize : Permission
initialize =
    Permission


type Port
    = Port Int


type SocketPath
    = SocketPath String


type BindError
    = PortOutOfRange
    | EmptySocketPath
    | SocketPathContainsNull


tcpPort : Int -> Result BindError Port
tcpPort value =
    if value >= 1 && value <= 65535 then
        Ok (Port value)

    else
        Err PortOutOfRange


ephemeralPort : Port
ephemeralPort =
    Port 0


unixSocket : String -> Result BindError SocketPath
unixSocket value =
    if String.isEmpty value then
        Err EmptySocketPath

    else if String.contains "\u{0000}" value then
        Err SocketPathContainsNull

    else
        Ok (SocketPath value)


type Bind
    = TcpBind String Int
    | UnixBind String


type PublicAcknowledgement
    = PublicAcknowledgement


acknowledgePublicExposure : PublicAcknowledgement
acknowledgePublicExposure =
    PublicAcknowledgement


loopback : Port -> Bind
loopback (Port value) =
    TcpBind "127.0.0.1" value


public : PublicAcknowledgement -> Port -> Bind
public _ (Port value) =
    TcpBind "0.0.0.0" value


unix : SocketPath -> Bind
unix (SocketPath value) =
    UnixBind value


type Options
    = Options RawOptions


type alias RawOptions =
    { limits : RawLimits
    , headersTimeout : Int
    , requestTimeout : Int
    , decisionTimeout : Int
    , bodyTimeout : Int
    , writeTimeout : Int
    , finishTimeout : Int
    , keepAliveTimeout : Int
    , upgradeTimeout : Int
    , gracefulTimeout : Int
    }


type Limits
    = Limits RawLimits


type alias RawLimits =
    { connections : Int
    , exchanges : Int
    , requestBytes : Int
    , responseBytes : Int
    , upgrades : Int
    , closeWaiters : Int
    , requestsPerSocket : Int
    , headerPairs : Int
    }


type LimitError
    = LimitOutOfRange


limits : { connections : Int, exchanges : Int, requestBytes : Int, responseBytes : Int, upgrades : Int, closeWaiters : Int, requestsPerSocket : Int, headerPairs : Int } -> Result LimitError Limits
limits raw =
    if raw.connections >= 1 && raw.connections <= 10000 && raw.exchanges >= 1 && raw.exchanges <= 10000 && raw.requestBytes >= 1 && raw.requestBytes <= 67108864 && raw.responseBytes >= 1 && raw.responseBytes <= 67108864 && raw.upgrades >= 0 && raw.upgrades <= 10000 && raw.closeWaiters >= 1 && raw.closeWaiters <= 64 && raw.requestsPerSocket >= 1 && raw.requestsPerSocket <= 10000 && raw.headerPairs >= 1 && raw.headerPairs <= 1000 then
        Ok (Limits raw)

    else
        Err LimitOutOfRange


defaultLimits : RawLimits
defaultLimits =
    { connections = 256, exchanges = 128, requestBytes = 1048576, responseBytes = 4194304, upgrades = 32, closeWaiters = 8, requestsPerSocket = 1000, headerPairs = 100 }


defaults : Options
defaults =
    Options { limits = defaultLimits, headersTimeout = 15000, requestTimeout = 30000, decisionTimeout = 5000, bodyTimeout = 10000, writeTimeout = 10000, finishTimeout = 10000, keepAliveTimeout = 5000, upgradeTimeout = 5000, gracefulTimeout = 30000 }


withLimits : Limits -> Options -> Options
withLimits (Limits value) (Options opts) =
    Options { opts | limits = value }


mapTimeout : (RawOptions -> Int -> RawOptions) -> Int -> Options -> Result LimitError Options
mapTimeout setter value (Options opts) =
    if value >= 1 && value <= 600000 then
        Ok (Options (setter opts value))

    else
        Err LimitOutOfRange


withHeadersTimeout =
    mapTimeout (\o v -> { o | headersTimeout = v })


withRequestTimeout =
    mapTimeout (\o v -> { o | requestTimeout = v })


withDecisionTimeout =
    mapTimeout (\o v -> { o | decisionTimeout = v })


withBodyTimeout =
    mapTimeout (\o v -> { o | bodyTimeout = v })


withWriteTimeout =
    mapTimeout (\o v -> { o | writeTimeout = v })


withFinishTimeout =
    mapTimeout (\o v -> { o | finishTimeout = v })


withKeepAliveTimeout =
    mapTimeout (\o v -> { o | keepAliveTimeout = v })


withUpgradeTimeout =
    mapTimeout (\o v -> { o | upgradeTimeout = v })


withGracefulTimeout =
    mapTimeout (\o v -> { o | gracefulTimeout = v })


type Operation
    = Operation Int


type Listener
    = Listener Int Endpoint


type alias Endpoint =
    { host : String, port_ : Int, socketPath : Maybe String }


endpoint : Listener -> Endpoint
endpoint (Listener _ value) =
    value


type ListenError
    = ListenError ListenErrorKind


type ListenErrorKind
    = AddressInUse
    | PermissionDenied
    | UnsupportedRuntime
    | ListenTimedOut
    | ListenFailed
    | ListenManagerOverloaded


type alias ListenCallbacks msg =
    { onStarted : Operation -> msg, onFinished : Operation -> Result ListenError Listener -> msg }


listenErrorKind : ListenError -> ListenErrorKind
listenErrorKind (ListenError kind) =
    kind


listenErrorMessage : ListenError -> String
listenErrorMessage (ListenError kind) =
    case kind of
        AddressInUse ->
            "Address is already in use. Choose another port."

        PermissionDenied ->
            "Node cannot bind this address or port."

        UnsupportedRuntime ->
            "This Node runtime lacks a required bounded-server feature."

        ListenTimedOut ->
            "The listener did not start before its deadline."

        ListenFailed ->
            "The listener could not start."

        ListenManagerOverloaded ->
            "The HTTP manager command budget is full; retry later."


type RequestId
    = RequestId Int


type Request
    = Request RawRequest


type alias RawRequest =
    { id : Int, method_ : String, target_ : String, targetForm_ : String, version : String, headers_ : List Header, remote : String, encrypted_ : Bool }


type Header
    = Header String String


type TargetForm
    = OriginForm
    | AbsoluteForm
    | AuthorityForm
    | AsteriskForm
    | InvalidTargetForm


requestId (Request raw) =
    RequestId raw.id


method (Request raw) =
    raw.method_


target (Request raw) =
    raw.target_


targetForm (Request raw) =
    case raw.targetForm_ of
        "origin" ->
            OriginForm

        "absolute" ->
            AbsoluteForm

        "authority" ->
            AuthorityForm

        "asterisk" ->
            AsteriskForm

        _ ->
            InvalidTargetForm


httpVersion (Request raw) =
    raw.version


headers (Request raw) =
    raw.headers_


headerName (Header name _) =
    name


headerValue (Header _ value) =
    value


headerValues wanted (Request raw) =
    List.filterMap
        (\(Header name value) ->
            if name == String.toLower wanted then
                Just value

            else
                Nothing
        )
        raw.headers_


remoteAddress (Request raw) =
    raw.remote


encrypted (Request raw) =
    raw.encrypted_


type BodyReader
    = BodyReader Int


type BodyLimit
    = BodyLimit Int


bodyLimit value =
    if value >= 1 && value <= 67108864 then
        Ok (BodyLimit value)

    else
        Err LimitOutOfRange


type BodyEvent
    = BodyChunk BodyReader Bytes
    | BodyComplete (List Header)
    | BodyFailed BodyError


type BodyError
    = BodyTooLarge
    | BodyTimedOut
    | ClientAborted
    | BodyAlreadyClaimed
    | BodyUnavailable
    | BodyManagerOverloaded


type Response
    = Response Int


type Status
    = Status Int


type StatusError
    = InvalidStatus
    | InformationalStatusRejected


status value =
    if value >= 200 && value <= 999 then
        Ok (Status value)

    else if value >= 100 && value < 200 then
        Err InformationalStatusRejected

    else
        Err InvalidStatus


type HeaderError
    = InvalidHeaderName
    | InvalidHeaderValue
    | ForbiddenResponseHeader


responseHeader rawName value =
    let
        name =
            String.toLower rawName
    in
    if String.isEmpty name || not (List.all isTokenChar (String.toList name)) then
        Err InvalidHeaderName

    else if String.any (\c -> c == '\u{0000}' || c == '\u{000D}' || c == '\n') value then
        Err InvalidHeaderValue

    else if List.any ((==) name) [ "connection", "transfer-encoding", "content-length", "upgrade" ] then
        Err ForbiddenResponseHeader

    else
        Ok (Header name value)


type Body
    = Body Bytes


emptyBody =
    Body (BytesEncode.encode (BytesEncode.sequence []))


utf8Body value =
    Body (BytesEncode.encode (BytesEncode.string value))


bytesBody value =
    Body value


type ResponsePlan
    = ResponsePlan Int (List Header) Body


respond (Status code) responseHeaders body =
    ResponsePlan code responseHeaders body


text code value =
    case status code of
        Ok good ->
            respond good [ Header "content-type" "text/plain; charset=utf-8" ] (utf8Body value)

        Err _ ->
            ResponsePlan 500 [] emptyBody


bytes code value =
    case status code of
        Ok good ->
            respond good [] (bytesBody value)

        Err _ ->
            ResponsePlan 500 [] emptyBody


type StreamingPlan
    = StreamingPlan Int (List Header)


streaming (Status code) responseHeaders =
    StreamingPlan code responseHeaders


type Writer
    = Writer Int


type WriteResult
    = WriteAccepted
    | WriteDrained


type WriteError
    = PeerClosed
    | WriteTimedOut
    | WriteAlreadyPending
    | WriterEnded
    | ResponseTooLarge
    | InvalidResponse
    | WriteManagerOverloaded


type ResponseResult
    = AcceptedByNode
    | ResponsePeerClosed
    | ResponseTimedOut


type AbortReason
    = ClientClosed
    | ClientError
    | ApplicationAborted
    | DecisionTimedOut
    | ServerClosing


type Upgrade
    = Upgrade Int


type TransferResult
    = Transferred
    | TransferUnavailable
    | TransferRejected
    | TransferManagerOverloaded


type UpgradeDecision
    = UpgradeRejected
    | UpgradeTimedOut
    | UpgradeManagerOverloaded


type ClosePlan
    = ClosePlan Int


graceful =
    ClosePlan 30000


withCloseDeadline value _ =
    if value >= 1 && value <= 600000 then
        Ok (ClosePlan value)

    else
        Err LimitOutOfRange


type alias CloseReport =
    { completed : Int, rejected : Int, forced : Int }


type CloseError
    = UnknownListener
    | TooManyCloseWaiters
    | CloseFailed
    | CloseManagerOverloaded


type Event
    = RequestOffered Listener Request BodyReader Response
    | UpgradeOffered Listener Upgrade
    | RequestAborted Listener RequestId AbortReason
    | ListenerFailed Listener ListenError


type MyCmd msg
    = Listen Permission Bind Options (ListenCallbacks msg)
    | CancelListen Operation
    | ReadBody BodyReader BodyLimit (BodyEvent -> msg)
    | DiscardBody BodyReader (Result BodyError () -> msg)
    | Send Response ResponsePlan (Result WriteError ResponseResult -> msg)
    | Stream Response StreamingPlan (Result WriteError Writer -> msg)
    | Write Writer Bytes (Result WriteError WriteResult -> msg)
    | End Writer (Result WriteError ResponseResult -> msg)
    | Abort Response AbortReason
    | TransferRequest Response (TransferResult -> msg)
    | TransferUpgrade Upgrade (TransferResult -> msg)
    | RejectUpgrade Upgrade Int (UpgradeDecision -> msg)
    | Close Listener ClosePlan (Result CloseError CloseReport -> msg)


type EventRoute
    = EventRoute Int Int


eventRoute : Listener -> Int -> EventRoute
eventRoute (Listener listenerId _) stableOwner =
    EventRoute listenerId stableOwner


type MySub msg
    = Events EventRoute (Event -> msg)


listen permission bind_ options callbacks =
    command (Listen permission bind_ options callbacks)


cancelListen operation =
    command (CancelListen operation)


readBody reader limit_ tagger =
    command (ReadBody reader limit_ tagger)


discardBody reader tagger =
    command (DiscardBody reader tagger)


send response plan tagger =
    command (Send response plan tagger)


streamResponse response plan tagger =
    command (Stream response plan tagger)


write writer body tagger =
    command (Write writer body tagger)


end writer tagger =
    command (End writer tagger)


abort response reason =
    command (Abort response reason)


transferRequest response tagger =
    command (TransferRequest response tagger)


transferUpgrade upgrade tagger =
    command (TransferUpgrade upgrade tagger)


rejectUpgrade upgrade code tagger =
    command (RejectUpgrade upgrade code tagger)


close listener plan tagger =
    command (Close listener plan tagger)


onEvents route tagger =
    subscription (Events route tagger)


cmdMap f cmd =
    case cmd of
        Listen p b o c ->
            Listen p b o { onStarted = c.onStarted >> f, onFinished = \op result -> f (c.onFinished op result) }

        CancelListen op ->
            CancelListen op

        ReadBody r l tag ->
            ReadBody r l (tag >> f)

        DiscardBody r tag ->
            DiscardBody r (tag >> f)

        Send r p tag ->
            Send r p (tag >> f)

        Stream r p tag ->
            Stream r p (tag >> f)

        Write w b tag ->
            Write w b (tag >> f)

        End w tag ->
            End w (tag >> f)

        Abort r reason ->
            Abort r reason

        TransferRequest r tag ->
            TransferRequest r (tag >> f)

        TransferUpgrade u tag ->
            TransferUpgrade u (tag >> f)

        RejectUpgrade u code tag ->
            RejectUpgrade u code (tag >> f)

        Close l p tag ->
            Close l p (tag >> f)


subMap f (Events route tagger) =
    Events route (tagger >> f)


type Reply msg
    = ListenReply (Operation -> Result ListenError Listener -> msg)
    | BodyReply (BodyEvent -> msg)
    | DiscardReply (Result BodyError () -> msg)
    | SendReply (Result WriteError ResponseResult -> msg)
    | StreamReply (Result WriteError Writer -> msg)
    | WriteReply (Result WriteError WriteResult -> msg)
    | EndReply (Result WriteError ResponseResult -> msg)
    | TransferReply (TransferResult -> msg)
    | UpgradeReply (UpgradeDecision -> msg)
    | CloseReply Int (Result CloseError CloseReport -> msg)


type RouteMode
    = Present
    | Absent
    | Ambiguous


type alias Route msg =
    { generation : Int, owner : Int, mode : RouteMode, tagger : Maybe (Event -> msg) }


type alias State msg =
    { next : Maybe Int, replies : Dict Int (Reply msg), routes : Dict Int (Route msg) }


type SelfMsg
    = ListenFact Int String Int String Int
    | BodyFact Int String Int Bytes (List { name : String, value : String })
    | UnitFact Int String
    | WriterFact Int String Int
    | TerminalFact Int String
    | CloseFact Int String Int Int Int
    | IncomingFact Int Int RawIncoming


type alias RawIncoming =
    { kind : String, request : RawRequest, bodyId : Int, responseId : Int, upgradeId : Int, reason : String }


type alias MyRouter msg =
    Platform.Router msg SelfMsg


init =
    Task.succeed { next = Just 1, replies = Dict.empty, routes = Dict.empty }


onEffects router commands subscriptions state =
    let
        routed =
            reconcile subscriptions state

        routeFacts =
            Dict.foldl (\id route acc -> { listenerId = id, generation = route.generation, present = route.mode == Present } :: acc) [] routed.routes
    in
    Elm.Kernel.HttpServer.configureRoutes router routeFacts IncomingFact
        |> Task.andThen (\_ -> dispatchAll router commands routed)


reconcile subscriptions state =
    let
        grouped =
            List.foldl (\(Events (EventRoute id owner) tagger) acc -> Dict.update id (\old -> Just (( owner, tagger ) :: Maybe.withDefault [] old)) acc) Dict.empty subscriptions

        ids =
            Dict.union (Dict.map (\_ _ -> ()) state.routes) (Dict.map (\_ _ -> ()) grouped)

        one id _ acc =
            let
                previous =
                    Dict.get id state.routes

                generation =
                    previous |> Maybe.map .generation |> Maybe.withDefault 0

                wasPresent =
                    previous |> Maybe.map (\r -> r.mode == Present) |> Maybe.withDefault False

                previousOwner =
                    previous |> Maybe.map .owner |> Maybe.withDefault -1
            in
            case Dict.get id grouped of
                Just [ ( owner, tagger ) ] ->
                    Dict.insert id
                        { generation =
                            if wasPresent && owner == previousOwner then
                                generation

                            else
                                generation + 1
                        , owner = owner
                        , mode = Present
                        , tagger = Just tagger
                        }
                        acc

                Just (_ :: _ :: _) ->
                    let
                        wasAmbiguous =
                            previous |> Maybe.map (\r -> r.mode == Ambiguous) |> Maybe.withDefault False
                    in
                    Dict.insert id
                        { generation =
                            if wasAmbiguous then
                                generation

                            else
                                generation + 1
                        , owner = -1
                        , mode = Ambiguous
                        , tagger = Nothing
                        }
                        acc

                _ ->
                    case previous of
                        Nothing ->
                            acc

                        Just route ->
                            Dict.insert id
                                { generation =
                                    if route.mode == Absent then
                                        generation

                                    else
                                        generation + 1
                                , owner = route.owner
                                , mode = Absent
                                , tagger = Nothing
                                }
                                acc
    in
    { state | routes = Dict.foldl one Dict.empty ids }


maxCommandsPerWave =
    1024


maxPendingReplies =
    4096


dispatchAll router commands state =
    dispatchWave router maxCommandsPerWave commands state


dispatchWave router remaining commands state =
    case commands of
        [] ->
            Task.succeed state

        first :: rest ->
            if remaining <= 0 || Dict.size state.replies >= maxPendingReplies then
                rejectOverloaded router first state |> Task.andThen (dispatchWave router 0 rest)

            else
                dispatch router first state |> Task.andThen (dispatchWave router (remaining - 1) rest)


rejectOverloaded router cmd state =
    case cmd of
        Listen _ _ _ callbacks ->
            Platform.sendToApp router (callbacks.onFinished (Operation 0) (Err (ListenError ListenManagerOverloaded))) |> Task.andThen (\_ -> Task.succeed state)

        ReadBody _ _ tag ->
            Platform.sendToApp router (tag (BodyFailed BodyManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        DiscardBody _ tag ->
            Platform.sendToApp router (tag (Err BodyManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        Send _ _ tag ->
            Platform.sendToApp router (tag (Err WriteManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        Stream _ _ tag ->
            Platform.sendToApp router (tag (Err WriteManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        Write _ _ tag ->
            Platform.sendToApp router (tag (Err WriteManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        End _ tag ->
            Platform.sendToApp router (tag (Err WriteManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        TransferRequest _ tag ->
            Platform.sendToApp router (tag TransferManagerOverloaded) |> Task.andThen (\_ -> Task.succeed state)

        TransferUpgrade _ tag ->
            Platform.sendToApp router (tag TransferManagerOverloaded) |> Task.andThen (\_ -> Task.succeed state)

        RejectUpgrade _ _ tag ->
            Platform.sendToApp router (tag UpgradeManagerOverloaded) |> Task.andThen (\_ -> Task.succeed state)

        Close _ _ tag ->
            Platform.sendToApp router (tag (Err CloseManagerOverloaded)) |> Task.andThen (\_ -> Task.succeed state)

        CancelListen _ ->
            Task.succeed state

        Abort _ _ ->
            Task.succeed state


maxSafeInteger : Int
maxSafeInteger =
    9007199254740991


nextReply id reply state =
    ( id
    , { state
        | next =
            if id == maxSafeInteger then
                Nothing

            else
                Just (id + 1)
        , replies = Dict.insert id reply state.replies
      }
    )


dispatch router cmd state =
    case cmd of
        CancelListen (Operation id) ->
            Elm.Kernel.HttpServer.cancelListen id |> Task.andThen (\_ -> Task.succeed state)

        Abort (Response responseId) reason ->
            Elm.Kernel.HttpServer.abort responseId (abortName reason) |> Task.andThen (\_ -> Task.succeed state)

        _ ->
            case state.next of
                Nothing ->
                    rejectOverloaded router cmd state

                Just id ->
                    dispatchAllocated router id cmd state


dispatchAllocated router allocated cmd state =
    case cmd of
        Listen _ bind_ (Options opts) callbacks ->
            let
                ( kind, address, port_ ) =
                    case bind_ of
                        TcpBind host value ->
                            ( "tcp", host, value )

                        UnixBind path ->
                            ( "unix", path, 0 )

                ( id, next ) =
                    nextReply allocated (ListenReply callbacks.onFinished) state
            in
            Elm.Kernel.HttpServer.listen router id kind address port_ opts ListenFact |> Task.andThen (\_ -> Platform.sendToApp router (callbacks.onStarted (Operation id))) |> Task.andThen (\_ -> Task.succeed next)

        ReadBody (BodyReader bodyId) (BodyLimit limit_) tag ->
            let
                ( id, next ) =
                    nextReply allocated (BodyReply tag) state
            in
            Elm.Kernel.HttpServer.readBody router id bodyId limit_ BodyFact |> Task.andThen (\_ -> Task.succeed next)

        DiscardBody (BodyReader bodyId) tag ->
            let
                ( id, next ) =
                    nextReply allocated (DiscardReply tag) state
            in
            Elm.Kernel.HttpServer.discardBody router id bodyId UnitFact |> Task.andThen (\_ -> Task.succeed next)

        Send (Response responseId) (ResponsePlan code hs (Body body)) tag ->
            let
                ( id, next ) =
                    nextReply allocated (SendReply tag) state
            in
            Elm.Kernel.HttpServer.send router id responseId code (rawHeaders hs) body TerminalFact |> Task.andThen (\_ -> Task.succeed next)

        Stream (Response responseId) (StreamingPlan code hs) tag ->
            let
                ( id, next ) =
                    nextReply allocated (StreamReply tag) state
            in
            Elm.Kernel.HttpServer.stream router id responseId code (rawHeaders hs) WriterFact |> Task.andThen (\_ -> Task.succeed next)

        Write (Writer writerId) body tag ->
            let
                ( id, next ) =
                    nextReply allocated (WriteReply tag) state
            in
            Elm.Kernel.HttpServer.write router id writerId body UnitFact |> Task.andThen (\_ -> Task.succeed next)

        End (Writer writerId) tag ->
            let
                ( id, next ) =
                    nextReply allocated (EndReply tag) state
            in
            Elm.Kernel.HttpServer.end router id writerId TerminalFact |> Task.andThen (\_ -> Task.succeed next)

        TransferRequest (Response responseId) tag ->
            let
                ( id, next ) =
                    nextReply allocated (TransferReply tag) state
            in
            Elm.Kernel.HttpServer.transferRequest router id responseId UnitFact |> Task.andThen (\_ -> Task.succeed next)

        TransferUpgrade (Upgrade upgradeId) tag ->
            let
                ( id, next ) =
                    nextReply allocated (TransferReply tag) state
            in
            Elm.Kernel.HttpServer.transferUpgrade router id upgradeId UnitFact |> Task.andThen (\_ -> Task.succeed next)

        RejectUpgrade (Upgrade upgradeId) code tag ->
            let
                ( id, next ) =
                    nextReply allocated (UpgradeReply tag) state
            in
            Elm.Kernel.HttpServer.rejectUpgrade router id upgradeId code UnitFact |> Task.andThen (\_ -> Task.succeed next)

        Close (Listener listenerId _) (ClosePlan timeout) tag ->
            let
                ( id, next ) =
                    nextReply allocated (CloseReply listenerId tag) state
            in
            Elm.Kernel.HttpServer.close router id listenerId timeout CloseFact |> Task.andThen (\_ -> Task.succeed next)

        CancelListen _ ->
            Task.succeed state

        Abort _ _ ->
            Task.succeed state


onSelfMsg router fact state =
    case fact of
        ListenFact id kind listenerId host port_ ->
            claim id
                state
                (\reply ->
                    case reply of
                        ListenReply tag ->
                            Just (tag (Operation id) (decodeListen kind listenerId host port_))

                        _ ->
                            Nothing
                )
                router

        BodyFact id kind bodyId bytes_ trailers ->
            claim id
                state
                (\reply ->
                    case reply of
                        BodyReply tag ->
                            Just (tag (decodeBody kind bodyId bytes_ trailers))

                        _ ->
                            Nothing
                )
                router

        UnitFact id kind ->
            claim id
                state
                (\reply ->
                    case reply of
                        DiscardReply tag ->
                            Just
                                (tag
                                    (if kind == "ok" then
                                        Ok ()

                                     else
                                        Err (decodeBodyError kind)
                                    )
                                )

                        TransferReply tag ->
                            Just (tag (decodeTransfer kind))

                        WriteReply tag ->
                            Just (tag (decodeWrite kind))

                        UpgradeReply tag ->
                            Just
                                (tag
                                    (if kind == "timeout" then
                                        UpgradeTimedOut

                                     else
                                        UpgradeRejected
                                    )
                                )

                        _ ->
                            Nothing
                )
                router

        WriterFact id kind writerId ->
            claim id
                state
                (\reply ->
                    case reply of
                        StreamReply tag ->
                            Just
                                (tag
                                    (if kind == "ok" then
                                        Ok (Writer writerId)

                                     else
                                        Err (decodeWriteError kind)
                                    )
                                )

                        _ ->
                            Nothing
                )
                router

        TerminalFact id kind ->
            claim id
                state
                (\reply ->
                    case reply of
                        SendReply tag ->
                            Just (tag (decodeTerminal kind))

                        EndReply tag ->
                            Just (tag (decodeTerminal kind))

                        _ ->
                            Nothing
                )
                router

        CloseFact id kind completed rejected forced ->
            claimClose id kind completed rejected forced state router

        IncomingFact listenerId generation raw ->
            case Dict.get listenerId state.routes of
                Just route ->
                    case ( route.mode, route.tagger ) of
                        ( Present, Just tagger ) ->
                            if route.generation == generation then
                                Platform.sendToApp router (tagger (decodeIncoming listenerId raw)) |> Task.andThen (\_ -> Task.succeed state)

                            else
                                rejectRaw raw state

                        _ ->
                            rejectRaw raw state

                Nothing ->
                    rejectRaw raw state


rejectRaw raw state =
    Elm.Kernel.HttpServer.rejectStale raw.responseId raw.upgradeId |> Task.andThen (\_ -> Task.succeed state)


claimClose id kind completed rejected forced state router =
    case Dict.get id state.replies of
        Just (CloseReply listenerId tag) ->
            let
                withoutReply =
                    { state | replies = Dict.remove id state.replies }

                next =
                    if kind == "ok" then
                        { withoutReply | routes = Dict.remove listenerId withoutReply.routes }

                    else
                        withoutReply

                result =
                    if kind == "ok" then
                        Ok { completed = completed, rejected = rejected, forced = forced }

                    else
                        Err (decodeCloseError kind)
            in
            Platform.sendToApp router (tag result) |> Task.andThen (\_ -> Task.succeed next)

        _ ->
            Task.succeed { state | replies = Dict.remove id state.replies }


claim id state toMessage router =
    case Dict.get id state.replies of
        Nothing ->
            Task.succeed state

        Just reply ->
            let
                next =
                    { state | replies = Dict.remove id state.replies }
            in
            case toMessage reply of
                Nothing ->
                    Task.succeed next

                Just msg ->
                    Platform.sendToApp router msg |> Task.andThen (\_ -> Task.succeed next)


rawHeaders hs =
    List.map (\(Header name value) -> { name = name, value = value }) hs


decodeListen kind id host port_ =
    if kind == "ok" then
        Ok
            (Listener id
                { host = host
                , port_ = port_
                , socketPath =
                    if port_ == 0 then
                        Just host

                    else
                        Nothing
                }
            )

    else
        Err
            (ListenError
                (case kind of
                    "address-in-use" ->
                        AddressInUse

                    "permission" ->
                        PermissionDenied

                    "unsupported" ->
                        UnsupportedRuntime

                    "timeout" ->
                        ListenTimedOut

                    _ ->
                        ListenFailed
                )
            )


decodeBody kind id bytes_ trailers =
    case kind of
        "chunk" ->
            BodyChunk (BodyReader id) bytes_

        "complete" ->
            BodyComplete (List.map (\h -> Header h.name h.value) trailers)

        _ ->
            BodyFailed (decodeBodyError kind)


decodeBodyError kind =
    case kind of
        "too-large" ->
            BodyTooLarge

        "timeout" ->
            BodyTimedOut

        "aborted" ->
            ClientAborted

        "claimed" ->
            BodyAlreadyClaimed

        "overloaded" ->
            BodyManagerOverloaded

        _ ->
            BodyUnavailable


decodeWrite kind =
    case kind of
        "accepted" ->
            Ok WriteAccepted

        "drained" ->
            Ok WriteDrained

        _ ->
            Err (decodeWriteError kind)


decodeWriteError kind =
    case kind of
        "peer-closed" ->
            PeerClosed

        "timeout" ->
            WriteTimedOut

        "pending" ->
            WriteAlreadyPending

        "ended" ->
            WriterEnded

        "too-large" ->
            ResponseTooLarge

        "overloaded" ->
            WriteManagerOverloaded

        _ ->
            InvalidResponse


decodeTerminal kind =
    case kind of
        "finish" ->
            Ok AcceptedByNode

        "timeout" ->
            Ok ResponseTimedOut

        "peer-closed" ->
            Ok ResponsePeerClosed

        _ ->
            Err (decodeWriteError kind)


decodeCloseError kind =
    case kind of
        "unknown" ->
            UnknownListener

        "waiters" ->
            TooManyCloseWaiters

        "overloaded" ->
            CloseManagerOverloaded

        _ ->
            CloseFailed


decodeTransfer kind =
    case kind of
        "ok" ->
            Transferred

        "unavailable" ->
            TransferUnavailable

        _ ->
            TransferRejected


decodeIncoming listenerId raw =
    let
        listener =
            Listener listenerId { host = "", port_ = 0, socketPath = Nothing }
    in
    case raw.kind of
        "request" ->
            RequestOffered listener (Request raw.request) (BodyReader raw.bodyId) (Response raw.responseId)

        "upgrade" ->
            UpgradeOffered listener (Upgrade raw.upgradeId)

        "aborted" ->
            RequestAborted listener (RequestId raw.request.id) (decodeAbort raw.reason)

        _ ->
            ListenerFailed listener (ListenError ListenFailed)


decodeAbort reason =
    case reason of
        "client-error" ->
            ClientError

        "application" ->
            ApplicationAborted

        "decision-timeout" ->
            DecisionTimedOut

        "closing" ->
            ServerClosing

        _ ->
            ClientClosed


abortName reason =
    case reason of
        ClientClosed ->
            "client-closed"

        ClientError ->
            "client-error"

        ApplicationAborted ->
            "application"

        DecisionTimedOut ->
            "decision-timeout"

        ServerClosing ->
            "closing"


isTokenChar c =
    Char.isAlphaNum c || String.contains (String.fromChar c) "!#$%&'*+-.^_`|~"


stream : Response -> StreamingPlan -> (Result WriteError Writer -> msg) -> Cmd msg
stream =
    streamResponse
