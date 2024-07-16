import * as BidiMapper from 'chromium-bidi/lib/cjs/bidiMapper/BidiMapper.js';
import { k as CDPSession, D as Deferred, U as UnsupportedOperation, T as TargetCloseError, E as EventEmitter, n as CallbackRegistry, o as assert, d as debugError, p as debug, q as DisposableStack, r as disposeSymbol, s as inertIfDisposed, u as throwIfDisposed, v as Dialog, J as JSHandle, w as ElementHandle, A as AsyncIterableUtil, x as stringifyFunction, y as interpolateFunction, H as HTTPResponse, z as invokeAtMostOnceForArguments, B as HTTPRequest, F as handleError, S as STATUS_TEXTS, G as isPlainObject, I as isRegExp, K as isDate, P as PuppeteerURL, L as ProtocolError, M as TimeoutError, R as Realm$1, N as scriptInjector, O as getSourceUrlComment, Q as getSourcePuppeteerURLIfAvailable, V as isString, W as LazyArg, X as ARIAQueryHandler, Y as SOURCE_URL_REGEX, Z as WebWorker, _ as of, $ as combineLatest, f as fromEmitterEvent, m as map, a0 as first, a1 as raceWith, a2 as timeout, a3 as Accessibility, a4 as ConsoleMessage, a5 as defer, a as filter, a6 as isErrorLike, a7 as firstValueFrom, a8 as switchMap, a9 as delayWhen, aa as Frame, ab as throwIfDetached, ac as Keyboard, ad as Mouse, ae as MouseButton, af as Touchscreen, ag as EmulationManager, ah as Tracing, ai as Coverage, aj as parsePDFOptions, j as from, ak as evaluationString, al as Page, am as bubble, an as Target, ao as TargetType, ap as WEB_PERMISSION_TO_PROTOCOL_PERMISSION, aq as BrowserContext, ar as Browser$1 } from './background.js';
import * as Bidi from 'chromium-bidi/lib/cjs/protocol/protocol.js';

/**
 * @internal
 */
class BidiCdpSession extends CDPSession {
    static sessions = new Map();
    #detached = false;
    #connection;
    #sessionId = Deferred.create();
    frame;
    constructor(frame, sessionId) {
        super();
        this.frame = frame;
        if (!this.frame.page().browser().cdpSupported) {
            return;
        }
        const connection = this.frame.page().browser().connection;
        this.#connection = connection;
        if (sessionId) {
            this.#sessionId.resolve(sessionId);
            BidiCdpSession.sessions.set(sessionId, this);
        }
        else {
            (async () => {
                try {
                    const { result } = await connection.send('cdp.getSession', {
                        context: frame._id,
                    });
                    this.#sessionId.resolve(result.session);
                    BidiCdpSession.sessions.set(result.session, this);
                }
                catch (error) {
                    this.#sessionId.reject(error);
                }
            })();
        }
        // SAFETY: We never throw #sessionId.
        BidiCdpSession.sessions.set(this.#sessionId.value(), this);
    }
    connection() {
        return undefined;
    }
    async send(method, params, options) {
        if (this.#connection === undefined) {
            throw new UnsupportedOperation('CDP support is required for this feature. The current browser does not support CDP.');
        }
        if (this.#detached) {
            throw new TargetCloseError(`Protocol error (${method}): Session closed. Most likely the page has been closed.`);
        }
        const session = await this.#sessionId.valueOrThrow();
        const { result } = await this.#connection.send('cdp.sendCommand', {
            method: method,
            params: params,
            session,
        }, options?.timeout);
        return result.result;
    }
    async detach() {
        if (this.#connection === undefined ||
            this.#connection.closed ||
            this.#detached) {
            return;
        }
        try {
            await this.frame.client.send('Target.detachFromTarget', {
                sessionId: this.id(),
            });
        }
        finally {
            this.onClose();
        }
    }
    /**
     * @internal
     */
    onClose = () => {
        BidiCdpSession.sessions.delete(this.id());
        this.#detached = true;
    };
    id() {
        const value = this.#sessionId.value();
        return typeof value === 'string' ? value : '';
    }
}

/**
 * @license
 * Copyright 2017 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
const debugProtocolSend = debug('puppeteer:webDriverBiDi:SEND ►');
const debugProtocolReceive = debug('puppeteer:webDriverBiDi:RECV ◀');
/**
 * @internal
 */
class BidiConnection extends EventEmitter {
    #url;
    #transport;
    #delay;
    #timeout = 0;
    #closed = false;
    #callbacks = new CallbackRegistry();
    #emitters = [];
    constructor(url, transport, delay = 0, timeout) {
        super();
        this.#url = url;
        this.#delay = delay;
        this.#timeout = timeout ?? 180_000;
        this.#transport = transport;
        this.#transport.onmessage = this.onMessage.bind(this);
        this.#transport.onclose = this.unbind.bind(this);
    }
    get closed() {
        return this.#closed;
    }
    get url() {
        return this.#url;
    }
    pipeTo(emitter) {
        this.#emitters.push(emitter);
    }
    emit(type, event) {
        for (const emitter of this.#emitters) {
            emitter.emit(type, event);
        }
        return super.emit(type, event);
    }
    send(method, params, timeout) {
        assert(!this.#closed, 'Protocol error: Connection closed.');
        return this.#callbacks.create(method, timeout ?? this.#timeout, id => {
            const stringifiedMessage = JSON.stringify({
                id,
                method,
                params,
            });
            debugProtocolSend(stringifiedMessage);
            this.#transport.send(stringifiedMessage);
        });
    }
    /**
     * @internal
     */
    async onMessage(message) {
        if (this.#delay) {
            await new Promise(f => {
                return setTimeout(f, this.#delay);
            });
        }
        debugProtocolReceive(message);
        const object = JSON.parse(message);
        if ('type' in object) {
            switch (object.type) {
                case 'success':
                    this.#callbacks.resolve(object.id, object);
                    return;
                case 'error':
                    if (object.id === null) {
                        break;
                    }
                    this.#callbacks.reject(object.id, createProtocolError(object), `${object.error}: ${object.message}`);
                    return;
                case 'event':
                    if (isCdpEvent(object)) {
                        BidiCdpSession.sessions
                            .get(object.params.session)
                            ?.emit(object.params.event, object.params.params);
                        return;
                    }
                    // SAFETY: We know the method and parameter still match here.
                    this.emit(object.method, object.params);
                    return;
            }
        }
        // Even if the response in not in BiDi protocol format but `id` is provided, reject
        // the callback. This can happen if the endpoint supports CDP instead of BiDi.
        if ('id' in object) {
            this.#callbacks.reject(object.id, `Protocol Error. Message is not in BiDi protocol format: '${message}'`, object.message);
        }
        debugError(object);
    }
    /**
     * Unbinds the connection, but keeps the transport open. Useful when the transport will
     * be reused by other connection e.g. with different protocol.
     * @internal
     */
    unbind() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        // Both may still be invoked and produce errors
        this.#transport.onmessage = () => { };
        this.#transport.onclose = () => { };
        this.#callbacks.clear();
    }
    /**
     * Unbinds the connection and closes the transport.
     */
    dispose() {
        this.unbind();
        this.#transport.close();
    }
    getPendingProtocolErrors() {
        return this.#callbacks.getPendingProtocolErrors();
    }
}
/**
 * @internal
 */
function createProtocolError(object) {
    let message = `${object.error} ${object.message}`;
    if (object.stacktrace) {
        message += ` ${object.stacktrace}`;
    }
    return message;
}
function isCdpEvent(event) {
    return event.method.startsWith('cdp.');
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
const bidiServerLogger = (prefix, ...args) => {
    debug(`bidi:${prefix}`)(args);
};
/**
 * @internal
 */
async function connectBidiOverCdp(cdp, options) {
    const transportBiDi = new NoOpTransport();
    const cdpConnectionAdapter = new CdpConnectionAdapter(cdp);
    const pptrTransport = {
        send(message) {
            // Forwards a BiDi command sent by Puppeteer to the input of the BidiServer.
            transportBiDi.emitMessage(JSON.parse(message));
        },
        close() {
            bidiServer.close();
            cdpConnectionAdapter.close();
            cdp.dispose();
        },
        onmessage(_message) {
            // The method is overridden by the Connection.
        },
    };
    transportBiDi.on('bidiResponse', (message) => {
        // Forwards a BiDi event sent by BidiServer to Puppeteer.
        pptrTransport.onmessage(JSON.stringify(message));
    });
    const pptrBiDiConnection = new BidiConnection(cdp.url(), pptrTransport, cdp.delay, cdp.timeout);
    const bidiServer = await BidiMapper.BidiServer.createAndStart(transportBiDi, cdpConnectionAdapter, 
    // TODO: most likely need a little bit of refactoring
    cdpConnectionAdapter.browserClient(), '', {
        // Override Mapper's `unhandledPromptBehavior` default value of `dismiss` to
        // `ignore`, so that user can handle the prompt instead of just closing it.
        unhandledPromptBehavior: {
            default: "ignore" /* Bidi.Session.UserPromptHandlerType.Ignore */,
        },
        ...options,
    }, undefined, bidiServerLogger);
    return pptrBiDiConnection;
}
/**
 * Manages CDPSessions for BidiServer.
 * @internal
 */
class CdpConnectionAdapter {
    #cdp;
    #adapters = new Map();
    #browserCdpConnection;
    constructor(cdp) {
        this.#cdp = cdp;
        this.#browserCdpConnection = new CDPClientAdapter(cdp);
    }
    browserClient() {
        return this.#browserCdpConnection;
    }
    getCdpClient(id) {
        const session = this.#cdp.session(id);
        if (!session) {
            throw new Error(`Unknown CDP session with id ${id}`);
        }
        if (!this.#adapters.has(session)) {
            const adapter = new CDPClientAdapter(session, id, this.#browserCdpConnection);
            this.#adapters.set(session, adapter);
            return adapter;
        }
        return this.#adapters.get(session);
    }
    close() {
        this.#browserCdpConnection.close();
        for (const adapter of this.#adapters.values()) {
            adapter.close();
        }
    }
}
/**
 * Wrapper on top of CDPSession/CDPConnection to satisfy CDP interface that
 * BidiServer needs.
 *
 * @internal
 */
class CDPClientAdapter extends BidiMapper.EventEmitter {
    #closed = false;
    #client;
    sessionId = undefined;
    #browserClient;
    constructor(client, sessionId, browserClient) {
        super();
        this.#client = client;
        this.sessionId = sessionId;
        this.#browserClient = browserClient;
        this.#client.on('*', this.#forwardMessage);
    }
    browserClient() {
        return this.#browserClient;
    }
    #forwardMessage = (method, event) => {
        this.emit(method, event);
    };
    async sendCommand(method, ...params) {
        if (this.#closed) {
            return;
        }
        try {
            return await this.#client.send(method, ...params);
        }
        catch (err) {
            if (this.#closed) {
                return;
            }
            throw err;
        }
    }
    close() {
        this.#client.off('*', this.#forwardMessage);
        this.#closed = true;
    }
    isCloseError(error) {
        return error instanceof TargetCloseError;
    }
}
/**
 * This transport is given to the BiDi server instance and allows Puppeteer
 * to send and receive commands to the BiDiServer.
 * @internal
 */
class NoOpTransport extends BidiMapper.EventEmitter {
    #onMessage = async (_m) => {
        return;
    };
    emitMessage(message) {
        void this.#onMessage(message);
    }
    setOnMessage(onMessage) {
        this.#onMessage = onMessage;
    }
    async sendMessage(message) {
        this.emit('bidiResponse', message);
    }
    close() {
        this.#onMessage = async (_m) => {
            return;
        };
    }
}

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$d = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$d = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * @internal
 */
let Navigation = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    return class Navigation extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$d(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(context) {
            const navigation = new Navigation(context);
            navigation.#initialize();
            return navigation;
        }
        #request = __runInitializers$d(this, _instanceExtraInitializers);
        #navigation;
        #browsingContext;
        #disposables = new DisposableStack();
        #id;
        constructor(context) {
            super();
            this.#browsingContext = context;
        }
        #initialize() {
            const browsingContextEmitter = this.#disposables.use(new EventEmitter(this.#browsingContext));
            browsingContextEmitter.once('closed', () => {
                this.emit('failed', {
                    url: this.#browsingContext.url,
                    timestamp: new Date(),
                });
                this.dispose();
            });
            browsingContextEmitter.on('request', ({ request }) => {
                if (request.navigation === undefined ||
                    // If a request with a navigation ID comes in, then the navigation ID is
                    // for this navigation.
                    !this.#matches(request.navigation)) {
                    return;
                }
                this.#request = request;
                this.emit('request', request);
                const requestEmitter = this.#disposables.use(new EventEmitter(this.#request));
                requestEmitter.on('redirect', request => {
                    this.#request = request;
                });
            });
            const sessionEmitter = this.#disposables.use(new EventEmitter(this.#session));
            sessionEmitter.on('browsingContext.navigationStarted', info => {
                if (info.context !== this.#browsingContext.id ||
                    this.#navigation !== undefined) {
                    return;
                }
                this.#navigation = Navigation.from(this.#browsingContext);
            });
            for (const eventName of [
                'browsingContext.domContentLoaded',
                'browsingContext.load',
            ]) {
                sessionEmitter.on(eventName, info => {
                    if (info.context !== this.#browsingContext.id ||
                        info.navigation === null ||
                        !this.#matches(info.navigation)) {
                        return;
                    }
                    this.dispose();
                });
            }
            for (const [eventName, event] of [
                ['browsingContext.fragmentNavigated', 'fragment'],
                ['browsingContext.navigationFailed', 'failed'],
                ['browsingContext.navigationAborted', 'aborted'],
            ]) {
                sessionEmitter.on(eventName, info => {
                    if (info.context !== this.#browsingContext.id ||
                        // Note we don't check if `navigation` is null since `null` means the
                        // fragment navigated.
                        !this.#matches(info.navigation)) {
                        return;
                    }
                    this.emit(event, {
                        url: info.url,
                        timestamp: new Date(info.timestamp),
                    });
                    this.dispose();
                });
            }
        }
        #matches(navigation) {
            if (this.#navigation !== undefined && !this.#navigation.disposed) {
                return false;
            }
            if (this.#id === undefined) {
                this.#id = navigation;
                return true;
            }
            return this.#id === navigation;
        }
        get #session() {
            return this.#browsingContext.userContext.browser.session;
        }
        get disposed() {
            return this.#disposables.disposed;
        }
        get request() {
            return this.#request;
        }
        get navigation() {
            return this.#navigation;
        }
        dispose() {
            this[disposeSymbol]();
        }
        [(_dispose_decorators = [inertIfDisposed], disposeSymbol)]() {
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$c = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$c = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var _a$1;
/**
 * @internal
 */
let Realm = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    let _disown_decorators;
    let _callFunction_decorators;
    let _evaluate_decorators;
    let _resolveExecutionContextId_decorators;
    return class Realm extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$c(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$c(this, null, _disown_decorators, { kind: "method", name: "disown", static: false, private: false, access: { has: obj => "disown" in obj, get: obj => obj.disown }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$c(this, null, _callFunction_decorators, { kind: "method", name: "callFunction", static: false, private: false, access: { has: obj => "callFunction" in obj, get: obj => obj.callFunction }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$c(this, null, _evaluate_decorators, { kind: "method", name: "evaluate", static: false, private: false, access: { has: obj => "evaluate" in obj, get: obj => obj.evaluate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$c(this, null, _resolveExecutionContextId_decorators, { kind: "method", name: "resolveExecutionContextId", static: false, private: false, access: { has: obj => "resolveExecutionContextId" in obj, get: obj => obj.resolveExecutionContextId }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        #reason = __runInitializers$c(this, _instanceExtraInitializers);
        disposables = new DisposableStack();
        id;
        origin;
        executionContextId;
        constructor(id, origin) {
            super();
            this.id = id;
            this.origin = origin;
        }
        get disposed() {
            return this.#reason !== undefined;
        }
        get target() {
            return { realm: this.id };
        }
        dispose(reason) {
            this.#reason = reason;
            this[disposeSymbol]();
        }
        async disown(handles) {
            await this.session.send('script.disown', {
                target: this.target,
                handles,
            });
        }
        async callFunction(functionDeclaration, awaitPromise, options = {}) {
            const { result } = await this.session.send('script.callFunction', {
                functionDeclaration,
                awaitPromise,
                target: this.target,
                ...options,
            });
            return result;
        }
        async evaluate(expression, awaitPromise, options = {}) {
            const { result } = await this.session.send('script.evaluate', {
                expression,
                awaitPromise,
                target: this.target,
                ...options,
            });
            return result;
        }
        async resolveExecutionContextId() {
            if (!this.executionContextId) {
                const { result } = await this.session.connection.send('cdp.resolveRealm', { realm: this.id });
                this.executionContextId = result.executionContextId;
            }
            return this.executionContextId;
        }
        [(_dispose_decorators = [inertIfDisposed], _disown_decorators = [throwIfDisposed(realm => {
                // SAFETY: Disposal implies this exists.
                return realm.#reason;
            })], _callFunction_decorators = [throwIfDisposed(realm => {
                // SAFETY: Disposal implies this exists.
                return realm.#reason;
            })], _evaluate_decorators = [throwIfDisposed(realm => {
                // SAFETY: Disposal implies this exists.
                return realm.#reason;
            })], _resolveExecutionContextId_decorators = [throwIfDisposed(realm => {
                // SAFETY: Disposal implies this exists.
                return realm.#reason;
            })], disposeSymbol)]() {
            this.#reason ??=
                'Realm already destroyed, probably because all associated browsing contexts closed.';
            this.emit('destroyed', { reason: this.#reason });
            this.disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();
/**
 * @internal
 */
class WindowRealm extends Realm {
    static from(context, sandbox) {
        const realm = new WindowRealm(context, sandbox);
        realm.#initialize();
        return realm;
    }
    browsingContext;
    sandbox;
    #workers = new Map();
    constructor(context, sandbox) {
        super('', '');
        this.browsingContext = context;
        this.sandbox = sandbox;
    }
    #initialize() {
        const browsingContextEmitter = this.disposables.use(new EventEmitter(this.browsingContext));
        browsingContextEmitter.on('closed', ({ reason }) => {
            this.dispose(reason);
        });
        const sessionEmitter = this.disposables.use(new EventEmitter(this.session));
        sessionEmitter.on('script.realmCreated', info => {
            if (info.type !== 'window' ||
                info.context !== this.browsingContext.id ||
                info.sandbox !== this.sandbox) {
                return;
            }
            this.id = info.realm;
            this.origin = info.origin;
            this.executionContextId = undefined;
            this.emit('updated', this);
        });
        sessionEmitter.on('script.realmCreated', info => {
            if (info.type !== 'dedicated-worker') {
                return;
            }
            if (!info.owners.includes(this.id)) {
                return;
            }
            const realm = DedicatedWorkerRealm.from(this, info.realm, info.origin);
            this.#workers.set(realm.id, realm);
            const realmEmitter = this.disposables.use(new EventEmitter(realm));
            realmEmitter.once('destroyed', () => {
                realmEmitter.removeAllListeners();
                this.#workers.delete(realm.id);
            });
            this.emit('worker', realm);
        });
    }
    get session() {
        return this.browsingContext.userContext.browser.session;
    }
    get target() {
        return { context: this.browsingContext.id, sandbox: this.sandbox };
    }
}
/**
 * @internal
 */
class DedicatedWorkerRealm extends Realm {
    static from(owner, id, origin) {
        const realm = new _a$1(owner, id, origin);
        realm.#initialize();
        return realm;
    }
    #workers = new Map();
    owners;
    constructor(owner, id, origin) {
        super(id, origin);
        this.owners = new Set([owner]);
    }
    #initialize() {
        const sessionEmitter = this.disposables.use(new EventEmitter(this.session));
        sessionEmitter.on('script.realmDestroyed', info => {
            if (info.realm !== this.id) {
                return;
            }
            this.dispose('Realm already destroyed.');
        });
        sessionEmitter.on('script.realmCreated', info => {
            if (info.type !== 'dedicated-worker') {
                return;
            }
            if (!info.owners.includes(this.id)) {
                return;
            }
            const realm = _a$1.from(this, info.realm, info.origin);
            this.#workers.set(realm.id, realm);
            const realmEmitter = this.disposables.use(new EventEmitter(realm));
            realmEmitter.once('destroyed', () => {
                this.#workers.delete(realm.id);
            });
            this.emit('worker', realm);
        });
    }
    get session() {
        // SAFETY: At least one owner will exist.
        return this.owners.values().next().value.session;
    }
}
_a$1 = DedicatedWorkerRealm;
/**
 * @internal
 */
class SharedWorkerRealm extends Realm {
    static from(browser, id, origin) {
        const realm = new SharedWorkerRealm(browser, id, origin);
        realm.#initialize();
        return realm;
    }
    #workers = new Map();
    browser;
    constructor(browser, id, origin) {
        super(id, origin);
        this.browser = browser;
    }
    #initialize() {
        const sessionEmitter = this.disposables.use(new EventEmitter(this.session));
        sessionEmitter.on('script.realmDestroyed', info => {
            if (info.realm !== this.id) {
                return;
            }
            this.dispose('Realm already destroyed.');
        });
        sessionEmitter.on('script.realmCreated', info => {
            if (info.type !== 'dedicated-worker') {
                return;
            }
            if (!info.owners.includes(this.id)) {
                return;
            }
            const realm = DedicatedWorkerRealm.from(this, info.realm, info.origin);
            this.#workers.set(realm.id, realm);
            const realmEmitter = this.disposables.use(new EventEmitter(realm));
            realmEmitter.once('destroyed', () => {
                this.#workers.delete(realm.id);
            });
            this.emit('worker', realm);
        });
    }
    get session() {
        return this.browser.session;
    }
}

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$b = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$b = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * @internal
 */
let Request = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    return class Request extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$b(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(browsingContext, event) {
            const request = new Request(browsingContext, event);
            request.#initialize();
            return request;
        }
        #error = __runInitializers$b(this, _instanceExtraInitializers);
        #redirect;
        #response;
        #browsingContext;
        #disposables = new DisposableStack();
        #event;
        constructor(browsingContext, event) {
            super();
            this.#browsingContext = browsingContext;
            this.#event = event;
        }
        #initialize() {
            const browsingContextEmitter = this.#disposables.use(new EventEmitter(this.#browsingContext));
            browsingContextEmitter.once('closed', ({ reason }) => {
                this.#error = reason;
                this.emit('error', this.#error);
                this.dispose();
            });
            const sessionEmitter = this.#disposables.use(new EventEmitter(this.#session));
            sessionEmitter.on('network.beforeRequestSent', event => {
                if (event.context !== this.#browsingContext.id ||
                    event.request.request !== this.id ||
                    event.redirectCount !== this.#event.redirectCount + 1) {
                    return;
                }
                this.#redirect = Request.from(this.#browsingContext, event);
                this.emit('redirect', this.#redirect);
                this.dispose();
            });
            sessionEmitter.on('network.authRequired', event => {
                if (event.context !== this.#browsingContext.id ||
                    event.request.request !== this.id ||
                    // Don't try to authenticate for events that are not blocked
                    !event.isBlocked) {
                    return;
                }
                this.emit('authenticate', undefined);
            });
            sessionEmitter.on('network.fetchError', event => {
                if (event.context !== this.#browsingContext.id ||
                    event.request.request !== this.id ||
                    this.#event.redirectCount !== event.redirectCount) {
                    return;
                }
                this.#error = event.errorText;
                this.emit('error', this.#error);
                this.dispose();
            });
            sessionEmitter.on('network.responseCompleted', event => {
                if (event.context !== this.#browsingContext.id ||
                    event.request.request !== this.id ||
                    this.#event.redirectCount !== event.redirectCount) {
                    return;
                }
                this.#response = event.response;
                this.emit('success', this.#response);
                // In case this is a redirect.
                if (this.#response.status >= 300 && this.#response.status < 400) {
                    return;
                }
                this.dispose();
            });
        }
        get #session() {
            return this.#browsingContext.userContext.browser.session;
        }
        get disposed() {
            return this.#disposables.disposed;
        }
        get error() {
            return this.#error;
        }
        get headers() {
            return this.#event.request.headers;
        }
        get id() {
            return this.#event.request.request;
        }
        get initiator() {
            return this.#event.initiator;
        }
        get method() {
            return this.#event.request.method;
        }
        get navigation() {
            return this.#event.navigation ?? undefined;
        }
        get redirect() {
            return this.#redirect;
        }
        get lastRedirect() {
            let redirect = this.#redirect;
            while (redirect) {
                if (redirect && !redirect.#redirect) {
                    return redirect;
                }
                redirect = redirect.#redirect;
            }
            return redirect;
        }
        get response() {
            return this.#response;
        }
        get url() {
            return this.#event.request.url;
        }
        get isBlocked() {
            return this.#event.isBlocked;
        }
        async continueRequest({ url, method, headers, cookies, body, }) {
            await this.#session.send('network.continueRequest', {
                request: this.id,
                url,
                method,
                headers,
                body,
                cookies,
            });
        }
        async failRequest() {
            await this.#session.send('network.failRequest', {
                request: this.id,
            });
        }
        async provideResponse({ statusCode, reasonPhrase, headers, body, }) {
            await this.#session.send('network.provideResponse', {
                request: this.id,
                statusCode,
                reasonPhrase,
                headers,
                body,
            });
        }
        async continueWithAuth(parameters) {
            if (parameters.action === 'provideCredentials') {
                await this.#session.send('network.continueWithAuth', {
                    request: this.id,
                    action: parameters.action,
                    credentials: parameters.credentials,
                });
            }
            else {
                await this.#session.send('network.continueWithAuth', {
                    request: this.id,
                    action: parameters.action,
                });
            }
        }
        dispose() {
            this[disposeSymbol]();
        }
        [(_dispose_decorators = [inertIfDisposed], disposeSymbol)]() {
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$a = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$a = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * @internal
 */
let UserPrompt = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    let _handle_decorators;
    return class UserPrompt extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$a(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$a(this, null, _handle_decorators, { kind: "method", name: "handle", static: false, private: false, access: { has: obj => "handle" in obj, get: obj => obj.handle }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(browsingContext, info) {
            const userPrompt = new UserPrompt(browsingContext, info);
            userPrompt.#initialize();
            return userPrompt;
        }
        #reason = __runInitializers$a(this, _instanceExtraInitializers);
        #result;
        #disposables = new DisposableStack();
        browsingContext;
        info;
        constructor(context, info) {
            super();
            this.browsingContext = context;
            this.info = info;
        }
        #initialize() {
            const browserContextEmitter = this.#disposables.use(new EventEmitter(this.browsingContext));
            browserContextEmitter.once('closed', ({ reason }) => {
                this.dispose(`User prompt already closed: ${reason}`);
            });
            const sessionEmitter = this.#disposables.use(new EventEmitter(this.#session));
            sessionEmitter.on('browsingContext.userPromptClosed', parameters => {
                if (parameters.context !== this.browsingContext.id) {
                    return;
                }
                this.#result = parameters;
                this.emit('handled', parameters);
                this.dispose('User prompt already handled.');
            });
        }
        get #session() {
            return this.browsingContext.userContext.browser.session;
        }
        get closed() {
            return this.#reason !== undefined;
        }
        get disposed() {
            return this.closed;
        }
        get handled() {
            return this.#result !== undefined;
        }
        get result() {
            return this.#result;
        }
        dispose(reason) {
            this.#reason = reason;
            this[disposeSymbol]();
        }
        async handle(options = {}) {
            await this.#session.send('browsingContext.handleUserPrompt', {
                ...options,
                context: this.info.context,
            });
            // SAFETY: `handled` is triggered before the above promise resolved.
            return this.#result;
        }
        [(_dispose_decorators = [inertIfDisposed], _handle_decorators = [throwIfDisposed(prompt => {
                // SAFETY: Disposal implies this exists.
                return prompt.#reason;
            })], disposeSymbol)]() {
            this.#reason ??=
                'User prompt already closed, probably because the associated browsing context was destroyed.';
            this.emit('closed', { reason: this.#reason });
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$9 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$9 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * @internal
 */
let BrowsingContext = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    let _activate_decorators;
    let _captureScreenshot_decorators;
    let _close_decorators;
    let _traverseHistory_decorators;
    let _navigate_decorators;
    let _reload_decorators;
    let _setCacheBehavior_decorators;
    let _print_decorators;
    let _handleUserPrompt_decorators;
    let _setViewport_decorators;
    let _performActions_decorators;
    let _releaseActions_decorators;
    let _createWindowRealm_decorators;
    let _addPreloadScript_decorators;
    let _addIntercept_decorators;
    let _removePreloadScript_decorators;
    let _getCookies_decorators;
    let _setCookie_decorators;
    let _setFiles_decorators;
    let _subscribe_decorators;
    let _addInterception_decorators;
    let _deleteCookie_decorators;
    let _locateNodes_decorators;
    return class BrowsingContext extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _deleteCookie_decorators = [throwIfDisposed(context => {
                    // SAFETY: Disposal implies this exists.
                    return context.#reason;
                })];
            _locateNodes_decorators = [throwIfDisposed(context => {
                    // SAFETY: Disposal implies this exists.
                    return context.#reason;
                })];
            __esDecorate$9(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _activate_decorators, { kind: "method", name: "activate", static: false, private: false, access: { has: obj => "activate" in obj, get: obj => obj.activate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _captureScreenshot_decorators, { kind: "method", name: "captureScreenshot", static: false, private: false, access: { has: obj => "captureScreenshot" in obj, get: obj => obj.captureScreenshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _close_decorators, { kind: "method", name: "close", static: false, private: false, access: { has: obj => "close" in obj, get: obj => obj.close }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _traverseHistory_decorators, { kind: "method", name: "traverseHistory", static: false, private: false, access: { has: obj => "traverseHistory" in obj, get: obj => obj.traverseHistory }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _navigate_decorators, { kind: "method", name: "navigate", static: false, private: false, access: { has: obj => "navigate" in obj, get: obj => obj.navigate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _reload_decorators, { kind: "method", name: "reload", static: false, private: false, access: { has: obj => "reload" in obj, get: obj => obj.reload }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _setCacheBehavior_decorators, { kind: "method", name: "setCacheBehavior", static: false, private: false, access: { has: obj => "setCacheBehavior" in obj, get: obj => obj.setCacheBehavior }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _print_decorators, { kind: "method", name: "print", static: false, private: false, access: { has: obj => "print" in obj, get: obj => obj.print }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _handleUserPrompt_decorators, { kind: "method", name: "handleUserPrompt", static: false, private: false, access: { has: obj => "handleUserPrompt" in obj, get: obj => obj.handleUserPrompt }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _setViewport_decorators, { kind: "method", name: "setViewport", static: false, private: false, access: { has: obj => "setViewport" in obj, get: obj => obj.setViewport }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _performActions_decorators, { kind: "method", name: "performActions", static: false, private: false, access: { has: obj => "performActions" in obj, get: obj => obj.performActions }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _releaseActions_decorators, { kind: "method", name: "releaseActions", static: false, private: false, access: { has: obj => "releaseActions" in obj, get: obj => obj.releaseActions }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _createWindowRealm_decorators, { kind: "method", name: "createWindowRealm", static: false, private: false, access: { has: obj => "createWindowRealm" in obj, get: obj => obj.createWindowRealm }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _addPreloadScript_decorators, { kind: "method", name: "addPreloadScript", static: false, private: false, access: { has: obj => "addPreloadScript" in obj, get: obj => obj.addPreloadScript }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _addIntercept_decorators, { kind: "method", name: "addIntercept", static: false, private: false, access: { has: obj => "addIntercept" in obj, get: obj => obj.addIntercept }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _removePreloadScript_decorators, { kind: "method", name: "removePreloadScript", static: false, private: false, access: { has: obj => "removePreloadScript" in obj, get: obj => obj.removePreloadScript }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _getCookies_decorators, { kind: "method", name: "getCookies", static: false, private: false, access: { has: obj => "getCookies" in obj, get: obj => obj.getCookies }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _setCookie_decorators, { kind: "method", name: "setCookie", static: false, private: false, access: { has: obj => "setCookie" in obj, get: obj => obj.setCookie }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _setFiles_decorators, { kind: "method", name: "setFiles", static: false, private: false, access: { has: obj => "setFiles" in obj, get: obj => obj.setFiles }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _subscribe_decorators, { kind: "method", name: "subscribe", static: false, private: false, access: { has: obj => "subscribe" in obj, get: obj => obj.subscribe }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _addInterception_decorators, { kind: "method", name: "addInterception", static: false, private: false, access: { has: obj => "addInterception" in obj, get: obj => obj.addInterception }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _deleteCookie_decorators, { kind: "method", name: "deleteCookie", static: false, private: false, access: { has: obj => "deleteCookie" in obj, get: obj => obj.deleteCookie }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$9(this, null, _locateNodes_decorators, { kind: "method", name: "locateNodes", static: false, private: false, access: { has: obj => "locateNodes" in obj, get: obj => obj.locateNodes }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(userContext, parent, id, url, originalOpener) {
            const browsingContext = new BrowsingContext(userContext, parent, id, url, originalOpener);
            browsingContext.#initialize();
            return browsingContext;
        }
        #navigation = __runInitializers$9(this, _instanceExtraInitializers);
        #reason;
        #url;
        #children = new Map();
        #disposables = new DisposableStack();
        #realms = new Map();
        #requests = new Map();
        defaultRealm;
        id;
        parent;
        userContext;
        originalOpener;
        constructor(context, parent, id, url, originalOpener) {
            super();
            this.#url = url;
            this.id = id;
            this.parent = parent;
            this.userContext = context;
            this.originalOpener = originalOpener;
            this.defaultRealm = this.#createWindowRealm();
        }
        #initialize() {
            const userContextEmitter = this.#disposables.use(new EventEmitter(this.userContext));
            userContextEmitter.once('closed', ({ reason }) => {
                this.dispose(`Browsing context already closed: ${reason}`);
            });
            const sessionEmitter = this.#disposables.use(new EventEmitter(this.#session));
            sessionEmitter.on('browsingContext.contextCreated', info => {
                if (info.parent !== this.id) {
                    return;
                }
                const browsingContext = BrowsingContext.from(this.userContext, this, info.context, info.url, info.originalOpener);
                this.#children.set(info.context, browsingContext);
                const browsingContextEmitter = this.#disposables.use(new EventEmitter(browsingContext));
                browsingContextEmitter.once('closed', () => {
                    browsingContextEmitter.removeAllListeners();
                    this.#children.delete(browsingContext.id);
                });
                this.emit('browsingcontext', { browsingContext });
            });
            sessionEmitter.on('browsingContext.contextDestroyed', info => {
                if (info.context !== this.id) {
                    return;
                }
                this.dispose('Browsing context already closed.');
            });
            sessionEmitter.on('browsingContext.domContentLoaded', info => {
                if (info.context !== this.id) {
                    return;
                }
                this.#url = info.url;
                this.emit('DOMContentLoaded', undefined);
            });
            sessionEmitter.on('browsingContext.load', info => {
                if (info.context !== this.id) {
                    return;
                }
                this.#url = info.url;
                this.emit('load', undefined);
            });
            sessionEmitter.on('browsingContext.navigationStarted', info => {
                if (info.context !== this.id) {
                    return;
                }
                // Note: we should not update this.#url at this point since the context
                // has not finished navigating to the info.url yet.
                for (const [id, request] of this.#requests) {
                    if (request.disposed) {
                        this.#requests.delete(id);
                    }
                }
                // If the navigation hasn't finished, then this is nested navigation. The
                // current navigation will handle this.
                if (this.#navigation !== undefined && !this.#navigation.disposed) {
                    return;
                }
                // Note the navigation ID is null for this event.
                this.#navigation = Navigation.from(this);
                const navigationEmitter = this.#disposables.use(new EventEmitter(this.#navigation));
                for (const eventName of ['fragment', 'failed', 'aborted']) {
                    navigationEmitter.once(eventName, ({ url }) => {
                        navigationEmitter[disposeSymbol]();
                        this.#url = url;
                    });
                }
                this.emit('navigation', { navigation: this.#navigation });
            });
            sessionEmitter.on('network.beforeRequestSent', event => {
                if (event.context !== this.id) {
                    return;
                }
                if (this.#requests.has(event.request.request)) {
                    // Means the request is a redirect. This is handled in Request.
                    // Or an Auth event was issued
                    return;
                }
                const request = Request.from(this, event);
                this.#requests.set(request.id, request);
                this.emit('request', { request });
            });
            sessionEmitter.on('log.entryAdded', entry => {
                if (entry.source.context !== this.id) {
                    return;
                }
                this.emit('log', { entry });
            });
            sessionEmitter.on('browsingContext.userPromptOpened', info => {
                if (info.context !== this.id) {
                    return;
                }
                const userPrompt = UserPrompt.from(this, info);
                this.emit('userprompt', { userPrompt });
            });
        }
        get #session() {
            return this.userContext.browser.session;
        }
        get children() {
            return this.#children.values();
        }
        get closed() {
            return this.#reason !== undefined;
        }
        get disposed() {
            return this.closed;
        }
        get realms() {
            // eslint-disable-next-line @typescript-eslint/no-this-alias -- Required
            const self = this;
            return (function* () {
                yield self.defaultRealm;
                yield* self.#realms.values();
            })();
        }
        get top() {
            let context = this;
            for (let { parent } = context; parent; { parent } = context) {
                context = parent;
            }
            return context;
        }
        get url() {
            return this.#url;
        }
        #createWindowRealm(sandbox) {
            const realm = WindowRealm.from(this, sandbox);
            realm.on('worker', realm => {
                this.emit('worker', { realm });
            });
            return realm;
        }
        dispose(reason) {
            this.#reason = reason;
            this[disposeSymbol]();
        }
        async activate() {
            await this.#session.send('browsingContext.activate', {
                context: this.id,
            });
        }
        async captureScreenshot(options = {}) {
            const { result: { data }, } = await this.#session.send('browsingContext.captureScreenshot', {
                context: this.id,
                ...options,
            });
            return data;
        }
        async close(promptUnload) {
            await Promise.all([...this.#children.values()].map(async (child) => {
                await child.close(promptUnload);
            }));
            await this.#session.send('browsingContext.close', {
                context: this.id,
                promptUnload,
            });
        }
        async traverseHistory(delta) {
            await this.#session.send('browsingContext.traverseHistory', {
                context: this.id,
                delta,
            });
        }
        async navigate(url, wait) {
            await this.#session.send('browsingContext.navigate', {
                context: this.id,
                url,
                wait,
            });
        }
        async reload(options = {}) {
            await this.#session.send('browsingContext.reload', {
                context: this.id,
                ...options,
            });
        }
        async setCacheBehavior(cacheBehavior) {
            // @ts-expect-error not in BiDi types yet.
            await this.#session.send('network.setCacheBehavior', {
                contexts: [this.id],
                cacheBehavior,
            });
        }
        async print(options = {}) {
            const { result: { data }, } = await this.#session.send('browsingContext.print', {
                context: this.id,
                ...options,
            });
            return data;
        }
        async handleUserPrompt(options = {}) {
            await this.#session.send('browsingContext.handleUserPrompt', {
                context: this.id,
                ...options,
            });
        }
        async setViewport(options = {}) {
            await this.#session.send('browsingContext.setViewport', {
                context: this.id,
                ...options,
            });
        }
        async performActions(actions) {
            await this.#session.send('input.performActions', {
                context: this.id,
                actions,
            });
        }
        async releaseActions() {
            await this.#session.send('input.releaseActions', {
                context: this.id,
            });
        }
        createWindowRealm(sandbox) {
            return this.#createWindowRealm(sandbox);
        }
        async addPreloadScript(functionDeclaration, options = {}) {
            return await this.userContext.browser.addPreloadScript(functionDeclaration, {
                ...options,
                contexts: [this],
            });
        }
        async addIntercept(options) {
            const { result: { intercept }, } = await this.userContext.browser.session.send('network.addIntercept', {
                ...options,
                contexts: [this.id],
            });
            return intercept;
        }
        async removePreloadScript(script) {
            await this.userContext.browser.removePreloadScript(script);
        }
        async getCookies(options = {}) {
            const { result: { cookies }, } = await this.#session.send('storage.getCookies', {
                ...options,
                partition: {
                    type: 'context',
                    context: this.id,
                },
            });
            return cookies;
        }
        async setCookie(cookie) {
            await this.#session.send('storage.setCookie', {
                cookie,
                partition: {
                    type: 'context',
                    context: this.id,
                },
            });
        }
        async setFiles(element, files) {
            await this.#session.send('input.setFiles', {
                context: this.id,
                element,
                files,
            });
        }
        async subscribe(events) {
            await this.#session.subscribe(events, [this.id]);
        }
        async addInterception(events) {
            await this.#session.subscribe(events, [this.id]);
        }
        [(_dispose_decorators = [inertIfDisposed], _activate_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _captureScreenshot_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _close_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _traverseHistory_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _navigate_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _reload_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _setCacheBehavior_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _print_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _handleUserPrompt_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _setViewport_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _performActions_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _releaseActions_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _createWindowRealm_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _addPreloadScript_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _addIntercept_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _removePreloadScript_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _getCookies_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _setCookie_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _setFiles_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _subscribe_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _addInterception_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], disposeSymbol)]() {
            this.#reason ??=
                'Browsing context already closed, probably because the user context closed.';
            this.emit('closed', { reason: this.#reason });
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
        async deleteCookie(...cookieFilters) {
            await Promise.all(cookieFilters.map(async (filter) => {
                await this.#session.send('storage.deleteCookies', {
                    filter: filter,
                    partition: {
                        type: 'context',
                        context: this.id,
                    },
                });
            }));
        }
        async locateNodes(locator, startNodes) {
            // TODO: add other locateNodes options if needed.
            const result = await this.#session.send('browsingContext.locateNodes', {
                context: this.id,
                locator,
                startNodes: startNodes.length ? startNodes : undefined,
            });
            return result.result.nodes;
        }
    };
})();

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$8 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$8 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * @internal
 */
let UserContext = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    let _createBrowsingContext_decorators;
    let _remove_decorators;
    let _getCookies_decorators;
    let _setCookie_decorators;
    let _setPermissions_decorators;
    return class UserContext extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$8(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$8(this, null, _createBrowsingContext_decorators, { kind: "method", name: "createBrowsingContext", static: false, private: false, access: { has: obj => "createBrowsingContext" in obj, get: obj => obj.createBrowsingContext }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$8(this, null, _remove_decorators, { kind: "method", name: "remove", static: false, private: false, access: { has: obj => "remove" in obj, get: obj => obj.remove }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$8(this, null, _getCookies_decorators, { kind: "method", name: "getCookies", static: false, private: false, access: { has: obj => "getCookies" in obj, get: obj => obj.getCookies }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$8(this, null, _setCookie_decorators, { kind: "method", name: "setCookie", static: false, private: false, access: { has: obj => "setCookie" in obj, get: obj => obj.setCookie }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$8(this, null, _setPermissions_decorators, { kind: "method", name: "setPermissions", static: false, private: false, access: { has: obj => "setPermissions" in obj, get: obj => obj.setPermissions }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static DEFAULT = 'default';
        static create(browser, id) {
            const context = new UserContext(browser, id);
            context.#initialize();
            return context;
        }
        #reason = __runInitializers$8(this, _instanceExtraInitializers);
        // Note these are only top-level contexts.
        #browsingContexts = new Map();
        #disposables = new DisposableStack();
        #id;
        browser;
        constructor(browser, id) {
            super();
            this.#id = id;
            this.browser = browser;
        }
        #initialize() {
            const browserEmitter = this.#disposables.use(new EventEmitter(this.browser));
            browserEmitter.once('closed', ({ reason }) => {
                this.dispose(`User context already closed: ${reason}`);
            });
            const sessionEmitter = this.#disposables.use(new EventEmitter(this.#session));
            sessionEmitter.on('browsingContext.contextCreated', info => {
                if (info.parent) {
                    return;
                }
                if (info.userContext !== this.#id) {
                    return;
                }
                const browsingContext = BrowsingContext.from(this, undefined, info.context, info.url, info.originalOpener);
                this.#browsingContexts.set(browsingContext.id, browsingContext);
                const browsingContextEmitter = this.#disposables.use(new EventEmitter(browsingContext));
                browsingContextEmitter.on('closed', () => {
                    browsingContextEmitter.removeAllListeners();
                    this.#browsingContexts.delete(browsingContext.id);
                });
                this.emit('browsingcontext', { browsingContext });
            });
        }
        get #session() {
            return this.browser.session;
        }
        get browsingContexts() {
            return this.#browsingContexts.values();
        }
        get closed() {
            return this.#reason !== undefined;
        }
        get disposed() {
            return this.closed;
        }
        get id() {
            return this.#id;
        }
        dispose(reason) {
            this.#reason = reason;
            this[disposeSymbol]();
        }
        async createBrowsingContext(type, options = {}) {
            const { result: { context: contextId }, } = await this.#session.send('browsingContext.create', {
                type,
                ...options,
                referenceContext: options.referenceContext?.id,
                userContext: this.#id,
            });
            const browsingContext = this.#browsingContexts.get(contextId);
            assert(browsingContext, 'The WebDriver BiDi implementation is failing to create a browsing context correctly.');
            // We use an array to avoid the promise from being awaited.
            return browsingContext;
        }
        async remove() {
            try {
                await this.#session.send('browser.removeUserContext', {
                    userContext: this.#id,
                });
            }
            finally {
                this.dispose('User context already closed.');
            }
        }
        async getCookies(options = {}, sourceOrigin = undefined) {
            const { result: { cookies }, } = await this.#session.send('storage.getCookies', {
                ...options,
                partition: {
                    type: 'storageKey',
                    userContext: this.#id,
                    sourceOrigin,
                },
            });
            return cookies;
        }
        async setCookie(cookie, sourceOrigin) {
            await this.#session.send('storage.setCookie', {
                cookie,
                partition: {
                    type: 'storageKey',
                    sourceOrigin,
                    userContext: this.id,
                },
            });
        }
        async setPermissions(origin, descriptor, state) {
            await this.#session.send('permissions.setPermission', {
                origin,
                descriptor,
                state,
                userContext: this.#id,
            });
        }
        [(_dispose_decorators = [inertIfDisposed], _createBrowsingContext_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _remove_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _getCookies_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _setCookie_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], _setPermissions_decorators = [throwIfDisposed(context => {
                // SAFETY: Disposal implies this exists.
                return context.#reason;
            })], disposeSymbol)]() {
            this.#reason ??=
                'User context already closed, probably because the browser disconnected/closed.';
            this.emit('closed', { reason: this.#reason });
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @internal
 */
class BidiDeserializer {
    static deserialize(result) {
        if (!result) {
            debugError('Service did not produce a result.');
            return undefined;
        }
        switch (result.type) {
            case 'array':
                return result.value?.map(value => {
                    return this.deserialize(value);
                });
            case 'set':
                return result.value?.reduce((acc, value) => {
                    return acc.add(this.deserialize(value));
                }, new Set());
            case 'object':
                return result.value?.reduce((acc, tuple) => {
                    const { key, value } = this.#deserializeTuple(tuple);
                    acc[key] = value;
                    return acc;
                }, {});
            case 'map':
                return result.value?.reduce((acc, tuple) => {
                    const { key, value } = this.#deserializeTuple(tuple);
                    return acc.set(key, value);
                }, new Map());
            case 'promise':
                return {};
            case 'regexp':
                return new RegExp(result.value.pattern, result.value.flags);
            case 'date':
                return new Date(result.value);
            case 'undefined':
                return undefined;
            case 'null':
                return null;
            case 'number':
                return this.#deserializeNumber(result.value);
            case 'bigint':
                return BigInt(result.value);
            case 'boolean':
                return Boolean(result.value);
            case 'string':
                return result.value;
        }
        debugError(`Deserialization of type ${result.type} not supported.`);
        return undefined;
    }
    static #deserializeNumber(value) {
        switch (value) {
            case '-0':
                return -0;
            case 'NaN':
                return NaN;
            case 'Infinity':
                return Infinity;
            case '-Infinity':
                return -Infinity;
            default:
                return value;
        }
    }
    static #deserializeTuple([serializedKey, serializedValue]) {
        const key = typeof serializedKey === 'string'
            ? serializedKey
            : this.deserialize(serializedKey);
        const value = this.deserialize(serializedValue);
        return { key, value };
    }
}

/**
 * @license
 * Copyright 2017 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
class BidiDialog extends Dialog {
    static from(prompt) {
        return new BidiDialog(prompt);
    }
    #prompt;
    constructor(prompt) {
        super(prompt.info.type, prompt.info.message, prompt.info.defaultValue);
        this.#prompt = prompt;
    }
    async handle(options) {
        await this.#prompt.handle({
            accept: options.accept,
            userText: options.text,
        });
    }
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @internal
 */
class BidiJSHandle extends JSHandle {
    static from(value, realm) {
        return new BidiJSHandle(value, realm);
    }
    #remoteValue;
    realm;
    #disposed = false;
    constructor(value, realm) {
        super();
        this.#remoteValue = value;
        this.realm = realm;
    }
    get disposed() {
        return this.#disposed;
    }
    async jsonValue() {
        return await this.evaluate(value => {
            return value;
        });
    }
    asElement() {
        return null;
    }
    async dispose() {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        await this.realm.destroyHandles([this]);
    }
    get isPrimitiveValue() {
        switch (this.#remoteValue.type) {
            case 'string':
            case 'number':
            case 'bigint':
            case 'boolean':
            case 'undefined':
            case 'null':
                return true;
            default:
                return false;
        }
    }
    toString() {
        if (this.isPrimitiveValue) {
            return 'JSHandle:' + BidiDeserializer.deserialize(this.#remoteValue);
        }
        return 'JSHandle@' + this.#remoteValue.type;
    }
    get id() {
        return 'handle' in this.#remoteValue ? this.#remoteValue.handle : undefined;
    }
    remoteValue() {
        return this.#remoteValue;
    }
    remoteObject() {
        throw new UnsupportedOperation('Not available in WebDriver BiDi');
    }
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$7 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$7 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __addDisposableResource$5 = (undefined && undefined.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources$5 = (undefined && undefined.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        function next() {
            while (env.stack.length) {
                var rec = env.stack.pop();
                try {
                    var result = rec.dispose && rec.dispose.call(rec.value);
                    if (rec.async) return Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                }
                catch (e) {
                    fail(e);
                }
            }
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/**
 * @internal
 */
let BidiElementHandle = (() => {
    var _a;
    let _classSuper = ElementHandle;
    let _instanceExtraInitializers = [];
    let _autofill_decorators;
    let _contentFrame_decorators;
    return class BidiElementHandle extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _autofill_decorators = [throwIfDisposed()];
            _contentFrame_decorators = [throwIfDisposed(), (_a = ElementHandle).bindIsolatedHandle.bind(_a)];
            __esDecorate$7(this, null, _autofill_decorators, { kind: "method", name: "autofill", static: false, private: false, access: { has: obj => "autofill" in obj, get: obj => obj.autofill }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$7(this, null, _contentFrame_decorators, { kind: "method", name: "contentFrame", static: false, private: false, access: { has: obj => "contentFrame" in obj, get: obj => obj.contentFrame }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(value, realm) {
            return new BidiElementHandle(value, realm);
        }
        constructor(value, realm) {
            super(BidiJSHandle.from(value, realm));
            __runInitializers$7(this, _instanceExtraInitializers);
        }
        get realm() {
            // SAFETY: See the super call in the constructor.
            return this.handle.realm;
        }
        get frame() {
            return this.realm.environment;
        }
        remoteValue() {
            return this.handle.remoteValue();
        }
        async autofill(data) {
            const client = this.frame.client;
            const nodeInfo = await client.send('DOM.describeNode', {
                objectId: this.handle.id,
            });
            const fieldId = nodeInfo.node.backendNodeId;
            const frameId = this.frame._id;
            await client.send('Autofill.trigger', {
                fieldId,
                frameId,
                card: data.creditCard,
            });
        }
        async contentFrame() {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const handle = __addDisposableResource$5(env_1, (await this.evaluateHandle(element => {
                    if (element instanceof HTMLIFrameElement ||
                        element instanceof HTMLFrameElement) {
                        return element.contentWindow;
                    }
                    return;
                })), false);
                const value = handle.remoteValue();
                if (value.type === 'window') {
                    return (this.frame
                        .page()
                        .frames()
                        .find(frame => {
                        return frame._id === value.value.context;
                    }) ?? null);
                }
                return null;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources$5(env_1);
            }
        }
        async uploadFile(...files) {
            // Locate all files and confirm that they exist.
            // eslint-disable-next-line @typescript-eslint/consistent-type-imports
            let path;
            try {
                path = await import('path');
            }
            catch (error) {
                if (error instanceof TypeError) {
                    throw new Error(`JSHandle#uploadFile can only be used in Node-like environments.`);
                }
                throw error;
            }
            files = files.map(file => {
                if (path.win32.isAbsolute(file) || path.posix.isAbsolute(file)) {
                    return file;
                }
                else {
                    return path.resolve(file);
                }
            });
            await this.frame.setFiles(this, files);
        }
        async *queryAXTree(name, role) {
            const results = await this.frame.locateNodes(this, {
                type: 'accessibility',
                value: {
                    role,
                    name,
                },
            });
            return yield* AsyncIterableUtil.map(results, node => {
                // TODO: maybe change ownership since the default ownership is probably none.
                return Promise.resolve(BidiElementHandle.from(node, this.realm));
            });
        }
    };
})();

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __addDisposableResource$4 = (undefined && undefined.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources$4 = (undefined && undefined.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        function next() {
            while (env.stack.length) {
                var rec = env.stack.pop();
                try {
                    var result = rec.dispose && rec.dispose.call(rec.value);
                    if (rec.async) return Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                }
                catch (e) {
                    fail(e);
                }
            }
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/**
 * @internal
 */
class ExposeableFunction {
    static async from(frame, name, apply, isolate = false) {
        const func = new ExposeableFunction(frame, name, apply, isolate);
        await func.#initialize();
        return func;
    }
    #frame;
    name;
    #apply;
    #isolate;
    #channel;
    #scripts = [];
    #disposables = new DisposableStack();
    constructor(frame, name, apply, isolate = false) {
        this.#frame = frame;
        this.name = name;
        this.#apply = apply;
        this.#isolate = isolate;
        this.#channel = `__puppeteer__${this.#frame._id}_page_exposeFunction_${this.name}`;
    }
    async #initialize() {
        const connection = this.#connection;
        const channel = {
            type: 'channel',
            value: {
                channel: this.#channel,
                ownership: "root" /* Bidi.Script.ResultOwnership.Root */,
            },
        };
        const connectionEmitter = this.#disposables.use(new EventEmitter(connection));
        connectionEmitter.on(Bidi.ChromiumBidi.Script.EventNames.Message, this.#handleMessage);
        const functionDeclaration = stringifyFunction(interpolateFunction((callback) => {
            Object.assign(globalThis, {
                [PLACEHOLDER('name')]: function (...args) {
                    return new Promise((resolve, reject) => {
                        callback([resolve, reject, args]);
                    });
                },
            });
        }, { name: JSON.stringify(this.name) }));
        const frames = [this.#frame];
        for (const frame of frames) {
            frames.push(...frame.childFrames());
        }
        await Promise.all(frames.map(async (frame) => {
            const realm = this.#isolate ? frame.isolatedRealm() : frame.mainRealm();
            try {
                const [script] = await Promise.all([
                    frame.browsingContext.addPreloadScript(functionDeclaration, {
                        arguments: [channel],
                        sandbox: realm.sandbox,
                    }),
                    realm.realm.callFunction(functionDeclaration, false, {
                        arguments: [channel],
                    }),
                ]);
                this.#scripts.push([frame, script]);
            }
            catch (error) {
                // If it errors, the frame probably doesn't support call function. We
                // fail gracefully.
                debugError(error);
            }
        }));
    }
    get #connection() {
        return this.#frame.page().browser().connection;
    }
    #handleMessage = async (params) => {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            if (params.channel !== this.#channel) {
                return;
            }
            const realm = this.#getRealm(params.source);
            if (!realm) {
                // Unrelated message.
                return;
            }
            const dataHandle = __addDisposableResource$4(env_1, BidiJSHandle.from(params.data, realm), false);
            const argsHandle = __addDisposableResource$4(env_1, await dataHandle.evaluateHandle(([, , args]) => {
                return args;
            }), false);
            const stack = __addDisposableResource$4(env_1, new DisposableStack(), false);
            const args = [];
            for (const [index, handle] of await argsHandle.getProperties()) {
                stack.use(handle);
                // Element handles are passed as is.
                if (handle instanceof BidiElementHandle) {
                    args[+index] = handle;
                    stack.use(handle);
                    continue;
                }
                // Everything else is passed as the JS value.
                args[+index] = handle.jsonValue();
            }
            let result;
            try {
                result = await this.#apply(...(await Promise.all(args)));
            }
            catch (error) {
                try {
                    if (error instanceof Error) {
                        await dataHandle.evaluate(([, reject], name, message, stack) => {
                            const error = new Error(message);
                            error.name = name;
                            if (stack) {
                                error.stack = stack;
                            }
                            reject(error);
                        }, error.name, error.message, error.stack);
                    }
                    else {
                        await dataHandle.evaluate(([, reject], error) => {
                            reject(error);
                        }, error);
                    }
                }
                catch (error) {
                    debugError(error);
                }
                return;
            }
            try {
                await dataHandle.evaluate(([resolve], result) => {
                    resolve(result);
                }, result);
            }
            catch (error) {
                debugError(error);
            }
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources$4(env_1);
        }
    };
    #getRealm(source) {
        const frame = this.#findFrame(source.context);
        if (!frame) {
            // Unrelated message.
            return;
        }
        return frame.realm(source.realm);
    }
    #findFrame(id) {
        const frames = [this.#frame];
        for (const frame of frames) {
            if (frame._id === id) {
                return frame;
            }
            frames.push(...frame.childFrames());
        }
        return;
    }
    [Symbol.dispose]() {
        void this[Symbol.asyncDispose]().catch(debugError);
    }
    async [Symbol.asyncDispose]() {
        this.#disposables.dispose();
        await Promise.all(this.#scripts.map(async ([frame, script]) => {
            const realm = this.#isolate ? frame.isolatedRealm() : frame.mainRealm();
            try {
                await Promise.all([
                    realm.evaluate(name => {
                        delete globalThis[name];
                    }, this.name),
                    ...frame.childFrames().map(childFrame => {
                        return childFrame.evaluate(name => {
                            delete globalThis[name];
                        }, this.name);
                    }),
                    frame.browsingContext.removePreloadScript(script),
                ]);
            }
            catch (error) {
                debugError(error);
            }
        }));
    }
}

var __runInitializers$6 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$6 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * @internal
 */
let BidiHTTPResponse = (() => {
    let _classSuper = HTTPResponse;
    let _instanceExtraInitializers = [];
    let _remoteAddress_decorators;
    return class BidiHTTPResponse extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _remoteAddress_decorators = [invokeAtMostOnceForArguments];
            __esDecorate$6(this, null, _remoteAddress_decorators, { kind: "method", name: "remoteAddress", static: false, private: false, access: { has: obj => "remoteAddress" in obj, get: obj => obj.remoteAddress }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(data, request) {
            const response = new BidiHTTPResponse(data, request);
            response.#initialize();
            return response;
        }
        #data = __runInitializers$6(this, _instanceExtraInitializers);
        #request;
        constructor(data, request) {
            super();
            this.#data = data;
            this.#request = request;
        }
        #initialize() {
            if (this.#data.fromCache) {
                this.#request
                    .frame()
                    ?.page()
                    .trustedEmitter.emit("requestservedfromcache" /* PageEvent.RequestServedFromCache */, this.#request);
            }
            this.#request.frame()?.page().trustedEmitter.emit("response" /* PageEvent.Response */, this);
        }
        remoteAddress() {
            return {
                ip: '',
                port: -1,
            };
        }
        url() {
            return this.#data.url;
        }
        status() {
            return this.#data.status;
        }
        statusText() {
            return this.#data.statusText;
        }
        headers() {
            const headers = {};
            // TODO: Remove once the Firefox implementation is compliant with https://w3c.github.io/webdriver-bidi/#get-the-response-data.
            for (const header of this.#data.headers || []) {
                // TODO: How to handle Binary Headers
                // https://w3c.github.io/webdriver-bidi/#type-network-Header
                if (header.value.type === 'string') {
                    headers[header.name.toLowerCase()] = header.value.value;
                }
            }
            return headers;
        }
        request() {
            return this.#request;
        }
        fromCache() {
            return this.#data.fromCache;
        }
        timing() {
            // TODO: File and issue with BiDi spec
            throw new UnsupportedOperation();
        }
        frame() {
            return this.#request.frame();
        }
        fromServiceWorker() {
            return false;
        }
        securityDetails() {
            throw new UnsupportedOperation();
        }
        buffer() {
            throw new UnsupportedOperation();
        }
    };
})();

var _a;
const requests = new WeakMap();
/**
 * @internal
 */
class BidiHTTPRequest extends HTTPRequest {
    static from(bidiRequest, frame, redirect) {
        const request = new _a(bidiRequest, frame, redirect);
        request.#initialize();
        return request;
    }
    #redirectChain;
    #response = null;
    id;
    #frame;
    #request;
    constructor(request, frame, redirect) {
        super();
        requests.set(request, this);
        this.interception.enabled = request.isBlocked;
        this.#request = request;
        this.#frame = frame;
        this.#redirectChain = redirect ? redirect.#redirectChain : [];
        this.id = request.id;
    }
    get client() {
        return this.#frame.client;
    }
    #initialize() {
        this.#request.on('redirect', request => {
            const httpRequest = _a.from(request, this.#frame, this);
            this.#redirectChain.push(this);
            request.once('success', () => {
                this.#frame
                    .page()
                    .trustedEmitter.emit("requestfinished" /* PageEvent.RequestFinished */, httpRequest);
            });
            request.once('error', () => {
                this.#frame
                    .page()
                    .trustedEmitter.emit("requestfailed" /* PageEvent.RequestFailed */, httpRequest);
            });
            void httpRequest.finalizeInterceptions();
        });
        this.#request.once('success', data => {
            this.#response = BidiHTTPResponse.from(data, this);
        });
        this.#request.on('authenticate', this.#handleAuthentication);
        this.#frame.page().trustedEmitter.emit("request" /* PageEvent.Request */, this);
        if (this.#hasInternalHeaderOverwrite) {
            this.interception.handlers.push(async () => {
                await this.continue({
                    headers: this.headers(),
                }, 0);
            });
        }
    }
    url() {
        return this.#request.url;
    }
    resourceType() {
        throw new UnsupportedOperation();
    }
    method() {
        return this.#request.method;
    }
    postData() {
        throw new UnsupportedOperation();
    }
    hasPostData() {
        throw new UnsupportedOperation();
    }
    async fetchPostData() {
        throw new UnsupportedOperation();
    }
    get #hasInternalHeaderOverwrite() {
        return Boolean(Object.keys(this.#extraHTTPHeaders).length ||
            Object.keys(this.#userAgentHeaders).length);
    }
    get #extraHTTPHeaders() {
        return this.#frame?.page()._extraHTTPHeaders ?? {};
    }
    get #userAgentHeaders() {
        return this.#frame?.page()._userAgentHeaders ?? {};
    }
    headers() {
        const headers = {};
        for (const header of this.#request.headers) {
            headers[header.name.toLowerCase()] = header.value.value;
        }
        return {
            ...headers,
            ...this.#extraHTTPHeaders,
            ...this.#userAgentHeaders,
        };
    }
    response() {
        return this.#response;
    }
    failure() {
        if (this.#request.error === undefined) {
            return null;
        }
        return { errorText: this.#request.error };
    }
    isNavigationRequest() {
        return this.#request.navigation !== undefined;
    }
    initiator() {
        return this.#request.initiator;
    }
    redirectChain() {
        return this.#redirectChain.slice();
    }
    frame() {
        return this.#frame;
    }
    async continue(overrides, priority) {
        return await super.continue({
            headers: this.#hasInternalHeaderOverwrite ? this.headers() : undefined,
            ...overrides,
        }, priority);
    }
    async _continue(overrides = {}) {
        const headers = getBidiHeaders(overrides.headers);
        this.interception.handled = true;
        return await this.#request
            .continueRequest({
            url: overrides.url,
            method: overrides.method,
            body: overrides.postData
                ? {
                    type: 'base64',
                    value: btoa(overrides.postData),
                }
                : undefined,
            headers: headers.length > 0 ? headers : undefined,
        })
            .catch(error => {
            this.interception.handled = false;
            return handleError(error);
        });
    }
    async _abort() {
        this.interception.handled = true;
        return await this.#request.failRequest().catch(error => {
            this.interception.handled = false;
            throw error;
        });
    }
    async _respond(response, _priority) {
        this.interception.handled = true;
        let parsedBody;
        if (response.body) {
            parsedBody = HTTPRequest.getResponse(response.body);
        }
        const headers = getBidiHeaders(response.headers);
        const hasContentLength = headers.some(header => {
            return header.name === 'content-length';
        });
        if (response.contentType) {
            headers.push({
                name: 'content-type',
                value: {
                    type: 'string',
                    value: response.contentType,
                },
            });
        }
        if (parsedBody?.contentLength && !hasContentLength) {
            headers.push({
                name: 'content-length',
                value: {
                    type: 'string',
                    value: String(parsedBody.contentLength),
                },
            });
        }
        const status = response.status || 200;
        return await this.#request
            .provideResponse({
            statusCode: status,
            headers: headers.length > 0 ? headers : undefined,
            reasonPhrase: STATUS_TEXTS[status],
            body: parsedBody?.base64
                ? {
                    type: 'base64',
                    value: parsedBody?.base64,
                }
                : undefined,
        })
            .catch(error => {
            this.interception.handled = false;
            throw error;
        });
    }
    #authenticationHandled = false;
    #handleAuthentication = async () => {
        if (!this.#frame) {
            return;
        }
        const credentials = this.#frame.page()._credentials;
        if (credentials && !this.#authenticationHandled) {
            this.#authenticationHandled = true;
            void this.#request.continueWithAuth({
                action: 'provideCredentials',
                credentials: {
                    type: 'password',
                    username: credentials.username,
                    password: credentials.password,
                },
            });
        }
        else {
            void this.#request.continueWithAuth({
                action: 'cancel',
            });
        }
    };
}
_a = BidiHTTPRequest;
function getBidiHeaders(rawHeaders) {
    const headers = [];
    for (const [name, value] of Object.entries(rawHeaders ?? [])) {
        if (!Object.is(value, undefined)) {
            const values = Array.isArray(value) ? value : [value];
            for (const value of values) {
                headers.push({
                    name: name.toLowerCase(),
                    value: {
                        type: 'string',
                        value: String(value),
                    },
                });
            }
        }
    }
    return headers;
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @internal
 */
class UnserializableError extends Error {
}
/**
 * @internal
 */
class BidiSerializer {
    static serialize(arg) {
        switch (typeof arg) {
            case 'symbol':
            case 'function':
                throw new UnserializableError(`Unable to serializable ${typeof arg}`);
            case 'object':
                return this.#serializeObject(arg);
            case 'undefined':
                return {
                    type: 'undefined',
                };
            case 'number':
                return this.#serializeNumber(arg);
            case 'bigint':
                return {
                    type: 'bigint',
                    value: arg.toString(),
                };
            case 'string':
                return {
                    type: 'string',
                    value: arg,
                };
            case 'boolean':
                return {
                    type: 'boolean',
                    value: arg,
                };
        }
    }
    static #serializeNumber(arg) {
        let value;
        if (Object.is(arg, -0)) {
            value = '-0';
        }
        else if (Object.is(arg, Infinity)) {
            value = 'Infinity';
        }
        else if (Object.is(arg, -Infinity)) {
            value = '-Infinity';
        }
        else if (Object.is(arg, NaN)) {
            value = 'NaN';
        }
        else {
            value = arg;
        }
        return {
            type: 'number',
            value,
        };
    }
    static #serializeObject(arg) {
        if (arg === null) {
            return {
                type: 'null',
            };
        }
        else if (Array.isArray(arg)) {
            const parsedArray = arg.map(subArg => {
                return this.serialize(subArg);
            });
            return {
                type: 'array',
                value: parsedArray,
            };
        }
        else if (isPlainObject(arg)) {
            try {
                JSON.stringify(arg);
            }
            catch (error) {
                if (error instanceof TypeError &&
                    error.message.startsWith('Converting circular structure to JSON')) {
                    error.message += ' Recursive objects are not allowed.';
                }
                throw error;
            }
            const parsedObject = [];
            for (const key in arg) {
                parsedObject.push([this.serialize(key), this.serialize(arg[key])]);
            }
            return {
                type: 'object',
                value: parsedObject,
            };
        }
        else if (isRegExp(arg)) {
            return {
                type: 'regexp',
                value: {
                    pattern: arg.source,
                    flags: arg.flags,
                },
            };
        }
        else if (isDate(arg)) {
            return {
                type: 'date',
                value: arg.toISOString(),
            };
        }
        throw new UnserializableError('Custom object serialization not possible. Use plain objects instead.');
    }
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @internal
 */
function createEvaluationError(details) {
    if (details.exception.type !== 'error') {
        return BidiDeserializer.deserialize(details.exception);
    }
    const [name = '', ...parts] = details.text.split(': ');
    const message = parts.join(': ');
    const error = new Error(message);
    error.name = name;
    // The first line is this function which we ignore.
    const stackLines = [];
    if (details.stackTrace && stackLines.length < Error.stackTraceLimit) {
        for (const frame of details.stackTrace.callFrames.reverse()) {
            if (PuppeteerURL.isPuppeteerURL(frame.url) &&
                frame.url !== PuppeteerURL.INTERNAL_URL) {
                const url = PuppeteerURL.parse(frame.url);
                stackLines.unshift(`    at ${frame.functionName || url.functionName} (${url.functionName} at ${url.siteString}, <anonymous>:${frame.lineNumber}:${frame.columnNumber})`);
            }
            else {
                stackLines.push(`    at ${frame.functionName || '<anonymous>'} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`);
            }
            if (stackLines.length >= Error.stackTraceLimit) {
                break;
            }
        }
    }
    error.stack = [details.text, ...stackLines].join('\n');
    return error;
}
/**
 * @internal
 */
function rewriteNavigationError(message, ms) {
    return error => {
        if (error instanceof ProtocolError) {
            error.message += ` at ${message}`;
        }
        else if (error instanceof TimeoutError) {
            error.message = `Navigation timeout of ${ms} ms exceeded`;
        }
        throw error;
    };
}

var __addDisposableResource$3 = (undefined && undefined.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources$3 = (undefined && undefined.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        function next() {
            while (env.stack.length) {
                var rec = env.stack.pop();
                try {
                    var result = rec.dispose && rec.dispose.call(rec.value);
                    if (rec.async) return Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                }
                catch (e) {
                    fail(e);
                }
            }
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/**
 * @internal
 */
class BidiRealm extends Realm$1 {
    realm;
    constructor(realm, timeoutSettings) {
        super(timeoutSettings);
        this.realm = realm;
    }
    initialize() {
        this.realm.on('destroyed', ({ reason }) => {
            this.taskManager.terminateAll(new Error(reason));
            this.dispose();
        });
        this.realm.on('updated', () => {
            this.internalPuppeteerUtil = undefined;
            void this.taskManager.rerunAll();
        });
    }
    internalPuppeteerUtil;
    get puppeteerUtil() {
        const promise = Promise.resolve();
        scriptInjector.inject(script => {
            if (this.internalPuppeteerUtil) {
                void this.internalPuppeteerUtil.then(handle => {
                    void handle.dispose();
                });
            }
            this.internalPuppeteerUtil = promise.then(() => {
                return this.evaluateHandle(script);
            });
        }, !this.internalPuppeteerUtil);
        return this.internalPuppeteerUtil;
    }
    async evaluateHandle(pageFunction, ...args) {
        return await this.#evaluate(false, pageFunction, ...args);
    }
    async evaluate(pageFunction, ...args) {
        return await this.#evaluate(true, pageFunction, ...args);
    }
    async #evaluate(returnByValue, pageFunction, ...args) {
        const sourceUrlComment = getSourceUrlComment(getSourcePuppeteerURLIfAvailable(pageFunction)?.toString() ??
            PuppeteerURL.INTERNAL_URL);
        let responsePromise;
        const resultOwnership = returnByValue
            ? "none" /* Bidi.Script.ResultOwnership.None */
            : "root" /* Bidi.Script.ResultOwnership.Root */;
        const serializationOptions = returnByValue
            ? {}
            : {
                maxObjectDepth: 0,
                maxDomDepth: 0,
            };
        if (isString(pageFunction)) {
            const expression = SOURCE_URL_REGEX.test(pageFunction)
                ? pageFunction
                : `${pageFunction}\n${sourceUrlComment}\n`;
            responsePromise = this.realm.evaluate(expression, true, {
                resultOwnership,
                userActivation: true,
                serializationOptions,
            });
        }
        else {
            let functionDeclaration = stringifyFunction(pageFunction);
            functionDeclaration = SOURCE_URL_REGEX.test(functionDeclaration)
                ? functionDeclaration
                : `${functionDeclaration}\n${sourceUrlComment}\n`;
            responsePromise = this.realm.callFunction(functionDeclaration, 
            /* awaitPromise= */ true, {
                arguments: args.length
                    ? await Promise.all(args.map(arg => {
                        return this.serialize(arg);
                    }))
                    : [],
                resultOwnership,
                userActivation: true,
                serializationOptions,
            });
        }
        const result = await responsePromise;
        if ('type' in result && result.type === 'exception') {
            throw createEvaluationError(result.exceptionDetails);
        }
        return returnByValue
            ? BidiDeserializer.deserialize(result.result)
            : this.createHandle(result.result);
    }
    createHandle(result) {
        if ((result.type === 'node' || result.type === 'window') &&
            this instanceof BidiFrameRealm) {
            return BidiElementHandle.from(result, this);
        }
        return BidiJSHandle.from(result, this);
    }
    async serialize(arg) {
        if (arg instanceof LazyArg) {
            arg = await arg.get(this);
        }
        if (arg instanceof BidiJSHandle || arg instanceof BidiElementHandle) {
            if (arg.realm !== this) {
                if (!(arg.realm instanceof BidiFrameRealm) ||
                    !(this instanceof BidiFrameRealm)) {
                    throw new Error("Trying to evaluate JSHandle from different global types. Usually this means you're using a handle from a worker in a page or vice versa.");
                }
                if (arg.realm.environment !== this.environment) {
                    throw new Error("Trying to evaluate JSHandle from different frames. Usually this means you're using a handle from a page on a different page.");
                }
            }
            if (arg.disposed) {
                throw new Error('JSHandle is disposed!');
            }
            return arg.remoteValue();
        }
        return BidiSerializer.serialize(arg);
    }
    async destroyHandles(handles) {
        if (this.disposed) {
            return;
        }
        const handleIds = handles
            .map(({ id }) => {
            return id;
        })
            .filter((id) => {
            return id !== undefined;
        });
        if (handleIds.length === 0) {
            return;
        }
        await this.realm.disown(handleIds).catch(error => {
            // Exceptions might happen in case of a page been navigated or closed.
            // Swallow these since they are harmless and we don't leak anything in this case.
            debugError(error);
        });
    }
    async adoptHandle(handle) {
        return (await this.evaluateHandle(node => {
            return node;
        }, handle));
    }
    async transferHandle(handle) {
        if (handle.realm === this) {
            return handle;
        }
        const transferredHandle = this.adoptHandle(handle);
        await handle.dispose();
        return await transferredHandle;
    }
}
/**
 * @internal
 */
class BidiFrameRealm extends BidiRealm {
    static from(realm, frame) {
        const frameRealm = new BidiFrameRealm(realm, frame);
        frameRealm.#initialize();
        return frameRealm;
    }
    #frame;
    constructor(realm, frame) {
        super(realm, frame.timeoutSettings);
        this.#frame = frame;
    }
    #initialize() {
        super.initialize();
        // This should run first.
        this.realm.on('updated', () => {
            this.environment.clearDocumentHandle();
            this.#bindingsInstalled = false;
        });
    }
    #bindingsInstalled = false;
    get puppeteerUtil() {
        let promise = Promise.resolve();
        if (!this.#bindingsInstalled) {
            promise = Promise.all([
                ExposeableFunction.from(this.environment, '__ariaQuerySelector', ARIAQueryHandler.queryOne, !!this.sandbox),
                ExposeableFunction.from(this.environment, '__ariaQuerySelectorAll', async (element, selector) => {
                    const results = ARIAQueryHandler.queryAll(element, selector);
                    return await element.realm.evaluateHandle((...elements) => {
                        return elements;
                    }, ...(await AsyncIterableUtil.collect(results)));
                }, !!this.sandbox),
            ]);
            this.#bindingsInstalled = true;
        }
        return promise.then(() => {
            return super.puppeteerUtil;
        });
    }
    get sandbox() {
        return this.realm.sandbox;
    }
    get environment() {
        return this.#frame;
    }
    async adoptBackendNode(backendNodeId) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const { object } = await this.#frame.client.send('DOM.resolveNode', {
                backendNodeId,
                executionContextId: await this.realm.resolveExecutionContextId(),
            });
            const handle = __addDisposableResource$3(env_1, BidiElementHandle.from({
                handle: object.objectId,
                type: 'node',
            }, this), false);
            // We need the sharedId, so we perform the following to obtain it.
            return await handle.evaluateHandle(element => {
                return element;
            });
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources$3(env_1);
        }
    }
}
/**
 * @internal
 */
class BidiWorkerRealm extends BidiRealm {
    static from(realm, worker) {
        const workerRealm = new BidiWorkerRealm(realm, worker);
        workerRealm.initialize();
        return workerRealm;
    }
    #worker;
    constructor(realm, frame) {
        super(realm, frame.timeoutSettings);
        this.#worker = frame;
    }
    get environment() {
        return this.#worker;
    }
    async adoptBackendNode() {
        throw new Error('Cannot adopt DOM nodes into a worker.');
    }
}

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @internal
 */
class BidiWebWorker extends WebWorker {
    static from(frame, realm) {
        const worker = new BidiWebWorker(frame, realm);
        return worker;
    }
    #frame;
    #realm;
    constructor(frame, realm) {
        super(realm.origin);
        this.#frame = frame;
        this.#realm = BidiWorkerRealm.from(realm, this);
    }
    get frame() {
        return this.#frame;
    }
    mainRealm() {
        return this.#realm;
    }
    get client() {
        throw new UnsupportedOperation();
    }
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$5 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$5 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __setFunctionName$1 = (undefined && undefined.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
let BidiFrame = (() => {
    let _classSuper = Frame;
    let _instanceExtraInitializers = [];
    let _goto_decorators;
    let _setContent_decorators;
    let _waitForNavigation_decorators;
    let _private_waitForLoad$_decorators;
    let _private_waitForLoad$_descriptor;
    let _private_waitForNetworkIdle$_decorators;
    let _private_waitForNetworkIdle$_descriptor;
    let _setFiles_decorators;
    let _locateNodes_decorators;
    return class BidiFrame extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _goto_decorators = [throwIfDetached];
            _setContent_decorators = [throwIfDetached];
            _waitForNavigation_decorators = [throwIfDetached];
            _private_waitForLoad$_decorators = [throwIfDetached];
            _private_waitForNetworkIdle$_decorators = [throwIfDetached];
            _setFiles_decorators = [throwIfDetached];
            _locateNodes_decorators = [throwIfDetached];
            __esDecorate$5(this, null, _goto_decorators, { kind: "method", name: "goto", static: false, private: false, access: { has: obj => "goto" in obj, get: obj => obj.goto }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$5(this, null, _setContent_decorators, { kind: "method", name: "setContent", static: false, private: false, access: { has: obj => "setContent" in obj, get: obj => obj.setContent }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$5(this, null, _waitForNavigation_decorators, { kind: "method", name: "waitForNavigation", static: false, private: false, access: { has: obj => "waitForNavigation" in obj, get: obj => obj.waitForNavigation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$5(this, _private_waitForLoad$_descriptor = { value: __setFunctionName$1(function (options = {}) {
                    let { waitUntil = 'load' } = options;
                    const { timeout: ms = this.timeoutSettings.navigationTimeout() } = options;
                    if (!Array.isArray(waitUntil)) {
                        waitUntil = [waitUntil];
                    }
                    const events = new Set();
                    for (const lifecycleEvent of waitUntil) {
                        switch (lifecycleEvent) {
                            case 'load': {
                                events.add('load');
                                break;
                            }
                            case 'domcontentloaded': {
                                events.add('DOMContentLoaded');
                                break;
                            }
                        }
                    }
                    if (events.size === 0) {
                        return of(undefined);
                    }
                    return combineLatest([...events].map(event => {
                        return fromEmitterEvent(this.browsingContext, event);
                    })).pipe(map(() => { }), first(), raceWith(timeout(ms), this.#detached$().pipe(map(() => {
                        throw new Error('Frame detached.');
                    }))));
                }, "#waitForLoad$") }, _private_waitForLoad$_decorators, { kind: "method", name: "#waitForLoad$", static: false, private: true, access: { has: obj => #waitForLoad$ in obj, get: obj => obj.#waitForLoad$ }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$5(this, _private_waitForNetworkIdle$_descriptor = { value: __setFunctionName$1(function (options = {}) {
                    let { waitUntil = 'load' } = options;
                    if (!Array.isArray(waitUntil)) {
                        waitUntil = [waitUntil];
                    }
                    let concurrency = Infinity;
                    for (const event of waitUntil) {
                        switch (event) {
                            case 'networkidle0': {
                                concurrency = Math.min(0, concurrency);
                                break;
                            }
                            case 'networkidle2': {
                                concurrency = Math.min(2, concurrency);
                                break;
                            }
                        }
                    }
                    if (concurrency === Infinity) {
                        return of(undefined);
                    }
                    return this.page().waitForNetworkIdle$({
                        idleTime: 500,
                        timeout: options.timeout ?? this.timeoutSettings.timeout(),
                        concurrency,
                    });
                }, "#waitForNetworkIdle$") }, _private_waitForNetworkIdle$_decorators, { kind: "method", name: "#waitForNetworkIdle$", static: false, private: true, access: { has: obj => #waitForNetworkIdle$ in obj, get: obj => obj.#waitForNetworkIdle$ }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$5(this, null, _setFiles_decorators, { kind: "method", name: "setFiles", static: false, private: false, access: { has: obj => "setFiles" in obj, get: obj => obj.setFiles }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$5(this, null, _locateNodes_decorators, { kind: "method", name: "locateNodes", static: false, private: false, access: { has: obj => "locateNodes" in obj, get: obj => obj.locateNodes }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(parent, browsingContext) {
            const frame = new BidiFrame(parent, browsingContext);
            frame.#initialize();
            return frame;
        }
        #parent = __runInitializers$5(this, _instanceExtraInitializers);
        browsingContext;
        #frames = new WeakMap();
        realms;
        _id;
        client;
        accessibility;
        constructor(parent, browsingContext) {
            super();
            this.#parent = parent;
            this.browsingContext = browsingContext;
            this._id = browsingContext.id;
            this.client = new BidiCdpSession(this);
            this.realms = {
                default: BidiFrameRealm.from(this.browsingContext.defaultRealm, this),
                internal: BidiFrameRealm.from(this.browsingContext.createWindowRealm(`__puppeteer_internal_${Math.ceil(Math.random() * 10000)}`), this),
            };
            this.accessibility = new Accessibility(this.realms.default);
        }
        #initialize() {
            for (const browsingContext of this.browsingContext.children) {
                this.#createFrameTarget(browsingContext);
            }
            this.browsingContext.on('browsingcontext', ({ browsingContext }) => {
                this.#createFrameTarget(browsingContext);
            });
            this.browsingContext.on('closed', () => {
                for (const session of BidiCdpSession.sessions.values()) {
                    if (session.frame === this) {
                        session.onClose();
                    }
                }
                this.page().trustedEmitter.emit("framedetached" /* PageEvent.FrameDetached */, this);
            });
            this.browsingContext.on('request', ({ request }) => {
                const httpRequest = BidiHTTPRequest.from(request, this);
                request.once('success', () => {
                    this.page().trustedEmitter.emit("requestfinished" /* PageEvent.RequestFinished */, httpRequest);
                });
                request.once('error', () => {
                    this.page().trustedEmitter.emit("requestfailed" /* PageEvent.RequestFailed */, httpRequest);
                });
                void httpRequest.finalizeInterceptions();
            });
            this.browsingContext.on('navigation', ({ navigation }) => {
                navigation.once('fragment', () => {
                    this.page().trustedEmitter.emit("framenavigated" /* PageEvent.FrameNavigated */, this);
                });
            });
            this.browsingContext.on('load', () => {
                this.page().trustedEmitter.emit("load" /* PageEvent.Load */, undefined);
            });
            this.browsingContext.on('DOMContentLoaded', () => {
                this._hasStartedLoading = true;
                this.page().trustedEmitter.emit("domcontentloaded" /* PageEvent.DOMContentLoaded */, undefined);
                this.page().trustedEmitter.emit("framenavigated" /* PageEvent.FrameNavigated */, this);
            });
            this.browsingContext.on('userprompt', ({ userPrompt }) => {
                this.page().trustedEmitter.emit("dialog" /* PageEvent.Dialog */, BidiDialog.from(userPrompt));
            });
            this.browsingContext.on('log', ({ entry }) => {
                if (this._id !== entry.source.context) {
                    return;
                }
                if (isConsoleLogEntry(entry)) {
                    const args = entry.args.map(arg => {
                        return this.mainRealm().createHandle(arg);
                    });
                    const text = args
                        .reduce((value, arg) => {
                        const parsedValue = arg instanceof BidiJSHandle && arg.isPrimitiveValue
                            ? BidiDeserializer.deserialize(arg.remoteValue())
                            : arg.toString();
                        return `${value} ${parsedValue}`;
                    }, '')
                        .slice(1);
                    this.page().trustedEmitter.emit("console" /* PageEvent.Console */, new ConsoleMessage(entry.method, text, args, getStackTraceLocations(entry.stackTrace)));
                }
                else if (isJavaScriptLogEntry(entry)) {
                    const error = new Error(entry.text ?? '');
                    const messageHeight = error.message.split('\n').length;
                    const messageLines = error.stack.split('\n').splice(0, messageHeight);
                    const stackLines = [];
                    if (entry.stackTrace) {
                        for (const frame of entry.stackTrace.callFrames) {
                            // Note we need to add `1` because the values are 0-indexed.
                            stackLines.push(`    at ${frame.functionName || '<anonymous>'} (${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`);
                            if (stackLines.length >= Error.stackTraceLimit) {
                                break;
                            }
                        }
                    }
                    error.stack = [...messageLines, ...stackLines].join('\n');
                    this.page().trustedEmitter.emit("pageerror" /* PageEvent.PageError */, error);
                }
                else {
                    debugError(`Unhandled LogEntry with type "${entry.type}", text "${entry.text}" and level "${entry.level}"`);
                }
            });
            this.browsingContext.on('worker', ({ realm }) => {
                const worker = BidiWebWorker.from(this, realm);
                realm.on('destroyed', () => {
                    this.page().trustedEmitter.emit("workerdestroyed" /* PageEvent.WorkerDestroyed */, worker);
                });
                this.page().trustedEmitter.emit("workercreated" /* PageEvent.WorkerCreated */, worker);
            });
        }
        #createFrameTarget(browsingContext) {
            const frame = BidiFrame.from(this, browsingContext);
            this.#frames.set(browsingContext, frame);
            this.page().trustedEmitter.emit("frameattached" /* PageEvent.FrameAttached */, frame);
            browsingContext.on('closed', () => {
                this.#frames.delete(browsingContext);
            });
            return frame;
        }
        get timeoutSettings() {
            return this.page()._timeoutSettings;
        }
        mainRealm() {
            return this.realms.default;
        }
        isolatedRealm() {
            return this.realms.internal;
        }
        realm(id) {
            for (const realm of Object.values(this.realms)) {
                if (realm.realm.id === id) {
                    return realm;
                }
            }
            return;
        }
        page() {
            let parent = this.#parent;
            while (parent instanceof BidiFrame) {
                parent = parent.#parent;
            }
            return parent;
        }
        isOOPFrame() {
            throw new UnsupportedOperation();
        }
        url() {
            return this.browsingContext.url;
        }
        parentFrame() {
            if (this.#parent instanceof BidiFrame) {
                return this.#parent;
            }
            return null;
        }
        childFrames() {
            return [...this.browsingContext.children].map(child => {
                return this.#frames.get(child);
            });
        }
        #detached$() {
            return defer(() => {
                if (this.detached) {
                    return of(this);
                }
                return fromEmitterEvent(this.page().trustedEmitter, "framedetached" /* PageEvent.FrameDetached */).pipe(filter(detachedFrame => {
                    return detachedFrame === this;
                }));
            });
        }
        async goto(url, options = {}) {
            const [response] = await Promise.all([
                this.waitForNavigation(options),
                // Some implementations currently only report errors when the
                // readiness=interactive.
                //
                // Related: https://bugzilla.mozilla.org/show_bug.cgi?id=1846601
                this.browsingContext
                    .navigate(url, "interactive" /* Bidi.BrowsingContext.ReadinessState.Interactive */)
                    .catch(error => {
                    if (isErrorLike(error) &&
                        error.message.includes('net::ERR_HTTP_RESPONSE_CODE_FAILURE')) {
                        return;
                    }
                    throw error;
                }),
            ]).catch(rewriteNavigationError(url, options.timeout ?? this.timeoutSettings.navigationTimeout()));
            return response;
        }
        async setContent(html, options = {}) {
            await Promise.all([
                this.setFrameContent(html),
                firstValueFrom(combineLatest([
                    this.#waitForLoad$(options),
                    this.#waitForNetworkIdle$(options),
                ])),
            ]);
        }
        async waitForNavigation(options = {}) {
            const { timeout: ms = this.timeoutSettings.navigationTimeout() } = options;
            const frames = this.childFrames().map(frame => {
                return frame.#detached$();
            });
            return await firstValueFrom(combineLatest([
                fromEmitterEvent(this.browsingContext, 'navigation').pipe(switchMap(({ navigation }) => {
                    return this.#waitForLoad$(options).pipe(delayWhen(() => {
                        if (frames.length === 0) {
                            return of(undefined);
                        }
                        return combineLatest(frames);
                    }), raceWith(fromEmitterEvent(navigation, 'fragment'), fromEmitterEvent(navigation, 'failed'), fromEmitterEvent(navigation, 'aborted').pipe(map(({ url }) => {
                        throw new Error(`Navigation aborted: ${url}`);
                    }))), switchMap(() => {
                        if (navigation.request) {
                            function requestFinished$(request) {
                                // Reduces flakiness if the response events arrive after
                                // the load event.
                                // Usually, the response or error is already there at this point.
                                if (request.response || request.error) {
                                    return of(navigation);
                                }
                                if (request.redirect) {
                                    return requestFinished$(request.redirect);
                                }
                                return fromEmitterEvent(request, 'success')
                                    .pipe(raceWith(fromEmitterEvent(request, 'error')), raceWith(fromEmitterEvent(request, 'redirect')))
                                    .pipe(switchMap(() => {
                                    return requestFinished$(request);
                                }));
                            }
                            return requestFinished$(navigation.request);
                        }
                        return of(navigation);
                    }));
                })),
                this.#waitForNetworkIdle$(options),
            ]).pipe(map(([navigation]) => {
                const request = navigation.request;
                if (!request) {
                    return null;
                }
                const lastRequest = request.lastRedirect ?? request;
                const httpRequest = requests.get(lastRequest);
                return httpRequest.response();
            }), raceWith(timeout(ms), this.#detached$().pipe(map(() => {
                throw new TargetCloseError('Frame detached.');
            })))));
        }
        waitForDevicePrompt() {
            throw new UnsupportedOperation();
        }
        get detached() {
            return this.browsingContext.closed;
        }
        #exposedFunctions = new Map();
        async exposeFunction(name, apply) {
            if (this.#exposedFunctions.has(name)) {
                throw new Error(`Failed to add page binding with name ${name}: globalThis['${name}'] already exists!`);
            }
            const exposeable = await ExposeableFunction.from(this, name, apply);
            this.#exposedFunctions.set(name, exposeable);
        }
        async removeExposedFunction(name) {
            const exposedFunction = this.#exposedFunctions.get(name);
            if (!exposedFunction) {
                throw new Error(`Failed to remove page binding with name ${name}: window['${name}'] does not exists!`);
            }
            this.#exposedFunctions.delete(name);
            await exposedFunction[Symbol.asyncDispose]();
        }
        async createCDPSession() {
            const { sessionId } = await this.client.send('Target.attachToTarget', {
                targetId: this._id,
                flatten: true,
            });
            await this.browsingContext.subscribe([Bidi.ChromiumBidi.BiDiModule.Cdp]);
            return new BidiCdpSession(this, sessionId);
        }
        get #waitForLoad$() { return _private_waitForLoad$_descriptor.value; }
        get #waitForNetworkIdle$() { return _private_waitForNetworkIdle$_descriptor.value; }
        async setFiles(element, files) {
            await this.browsingContext.setFiles(
            // SAFETY: ElementHandles are always remote references.
            element.remoteValue(), files);
        }
        async locateNodes(element, locator) {
            return await this.browsingContext.locateNodes(locator, 
            // SAFETY: ElementHandles are always remote references.
            [element.remoteValue()]);
        }
    };
})();
function isConsoleLogEntry(event) {
    return event.type === 'console';
}
function isJavaScriptLogEntry(event) {
    return event.type === 'javascript';
}
function getStackTraceLocations(stackTrace) {
    const stackTraceLocations = [];
    if (stackTrace) {
        for (const callFrame of stackTrace.callFrames) {
            stackTraceLocations.push({
                url: callFrame.url,
                lineNumber: callFrame.lineNumber,
                columnNumber: callFrame.columnNumber,
            });
        }
    }
    return stackTraceLocations;
}

/**
 * @license
 * Copyright 2017 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var SourceActionsType;
(function (SourceActionsType) {
    SourceActionsType["None"] = "none";
    SourceActionsType["Key"] = "key";
    SourceActionsType["Pointer"] = "pointer";
    SourceActionsType["Wheel"] = "wheel";
})(SourceActionsType || (SourceActionsType = {}));
var ActionType;
(function (ActionType) {
    ActionType["Pause"] = "pause";
    ActionType["KeyDown"] = "keyDown";
    ActionType["KeyUp"] = "keyUp";
    ActionType["PointerUp"] = "pointerUp";
    ActionType["PointerDown"] = "pointerDown";
    ActionType["PointerMove"] = "pointerMove";
    ActionType["Scroll"] = "scroll";
})(ActionType || (ActionType = {}));
const getBidiKeyValue = (key) => {
    switch (key) {
        case '\r':
        case '\n':
            key = 'Enter';
            break;
    }
    // Measures the number of code points rather than UTF-16 code units.
    if ([...key].length === 1) {
        return key;
    }
    switch (key) {
        case 'Cancel':
            return '\uE001';
        case 'Help':
            return '\uE002';
        case 'Backspace':
            return '\uE003';
        case 'Tab':
            return '\uE004';
        case 'Clear':
            return '\uE005';
        case 'Enter':
            return '\uE007';
        case 'Shift':
        case 'ShiftLeft':
            return '\uE008';
        case 'Control':
        case 'ControlLeft':
            return '\uE009';
        case 'Alt':
        case 'AltLeft':
            return '\uE00A';
        case 'Pause':
            return '\uE00B';
        case 'Escape':
            return '\uE00C';
        case 'PageUp':
            return '\uE00E';
        case 'PageDown':
            return '\uE00F';
        case 'End':
            return '\uE010';
        case 'Home':
            return '\uE011';
        case 'ArrowLeft':
            return '\uE012';
        case 'ArrowUp':
            return '\uE013';
        case 'ArrowRight':
            return '\uE014';
        case 'ArrowDown':
            return '\uE015';
        case 'Insert':
            return '\uE016';
        case 'Delete':
            return '\uE017';
        case 'NumpadEqual':
            return '\uE019';
        case 'Numpad0':
            return '\uE01A';
        case 'Numpad1':
            return '\uE01B';
        case 'Numpad2':
            return '\uE01C';
        case 'Numpad3':
            return '\uE01D';
        case 'Numpad4':
            return '\uE01E';
        case 'Numpad5':
            return '\uE01F';
        case 'Numpad6':
            return '\uE020';
        case 'Numpad7':
            return '\uE021';
        case 'Numpad8':
            return '\uE022';
        case 'Numpad9':
            return '\uE023';
        case 'NumpadMultiply':
            return '\uE024';
        case 'NumpadAdd':
            return '\uE025';
        case 'NumpadSubtract':
            return '\uE027';
        case 'NumpadDecimal':
            return '\uE028';
        case 'NumpadDivide':
            return '\uE029';
        case 'F1':
            return '\uE031';
        case 'F2':
            return '\uE032';
        case 'F3':
            return '\uE033';
        case 'F4':
            return '\uE034';
        case 'F5':
            return '\uE035';
        case 'F6':
            return '\uE036';
        case 'F7':
            return '\uE037';
        case 'F8':
            return '\uE038';
        case 'F9':
            return '\uE039';
        case 'F10':
            return '\uE03A';
        case 'F11':
            return '\uE03B';
        case 'F12':
            return '\uE03C';
        case 'Meta':
        case 'MetaLeft':
            return '\uE03D';
        case 'ShiftRight':
            return '\uE050';
        case 'ControlRight':
            return '\uE051';
        case 'AltRight':
            return '\uE052';
        case 'MetaRight':
            return '\uE053';
        case 'Digit0':
            return '0';
        case 'Digit1':
            return '1';
        case 'Digit2':
            return '2';
        case 'Digit3':
            return '3';
        case 'Digit4':
            return '4';
        case 'Digit5':
            return '5';
        case 'Digit6':
            return '6';
        case 'Digit7':
            return '7';
        case 'Digit8':
            return '8';
        case 'Digit9':
            return '9';
        case 'KeyA':
            return 'a';
        case 'KeyB':
            return 'b';
        case 'KeyC':
            return 'c';
        case 'KeyD':
            return 'd';
        case 'KeyE':
            return 'e';
        case 'KeyF':
            return 'f';
        case 'KeyG':
            return 'g';
        case 'KeyH':
            return 'h';
        case 'KeyI':
            return 'i';
        case 'KeyJ':
            return 'j';
        case 'KeyK':
            return 'k';
        case 'KeyL':
            return 'l';
        case 'KeyM':
            return 'm';
        case 'KeyN':
            return 'n';
        case 'KeyO':
            return 'o';
        case 'KeyP':
            return 'p';
        case 'KeyQ':
            return 'q';
        case 'KeyR':
            return 'r';
        case 'KeyS':
            return 's';
        case 'KeyT':
            return 't';
        case 'KeyU':
            return 'u';
        case 'KeyV':
            return 'v';
        case 'KeyW':
            return 'w';
        case 'KeyX':
            return 'x';
        case 'KeyY':
            return 'y';
        case 'KeyZ':
            return 'z';
        case 'Semicolon':
            return ';';
        case 'Equal':
            return '=';
        case 'Comma':
            return ',';
        case 'Minus':
            return '-';
        case 'Period':
            return '.';
        case 'Slash':
            return '/';
        case 'Backquote':
            return '`';
        case 'BracketLeft':
            return '[';
        case 'Backslash':
            return '\\';
        case 'BracketRight':
            return ']';
        case 'Quote':
            return '"';
        default:
            throw new Error(`Unknown key: "${key}"`);
    }
};
/**
 * @internal
 */
class BidiKeyboard extends Keyboard {
    #page;
    constructor(page) {
        super();
        this.#page = page;
    }
    async down(key, _options) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Key,
                id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                actions: [
                    {
                        type: ActionType.KeyDown,
                        value: getBidiKeyValue(key),
                    },
                ],
            },
        ]);
    }
    async up(key) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Key,
                id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                actions: [
                    {
                        type: ActionType.KeyUp,
                        value: getBidiKeyValue(key),
                    },
                ],
            },
        ]);
    }
    async press(key, options = {}) {
        const { delay = 0 } = options;
        const actions = [
            {
                type: ActionType.KeyDown,
                value: getBidiKeyValue(key),
            },
        ];
        if (delay > 0) {
            actions.push({
                type: ActionType.Pause,
                duration: delay,
            });
        }
        actions.push({
            type: ActionType.KeyUp,
            value: getBidiKeyValue(key),
        });
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Key,
                id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                actions,
            },
        ]);
    }
    async type(text, options = {}) {
        const { delay = 0 } = options;
        // This spread separates the characters into code points rather than UTF-16
        // code units.
        const values = [...text].map(getBidiKeyValue);
        const actions = [];
        if (delay <= 0) {
            for (const value of values) {
                actions.push({
                    type: ActionType.KeyDown,
                    value,
                }, {
                    type: ActionType.KeyUp,
                    value,
                });
            }
        }
        else {
            for (const value of values) {
                actions.push({
                    type: ActionType.KeyDown,
                    value,
                }, {
                    type: ActionType.Pause,
                    duration: delay,
                }, {
                    type: ActionType.KeyUp,
                    value,
                });
            }
        }
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Key,
                id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                actions,
            },
        ]);
    }
    async sendCharacter(char) {
        // Measures the number of code points rather than UTF-16 code units.
        if ([...char].length > 1) {
            throw new Error('Cannot send more than 1 character.');
        }
        const frame = await this.#page.focusedFrame();
        await frame.isolatedRealm().evaluate(async (char) => {
            document.execCommand('insertText', false, char);
        }, char);
    }
}
const getBidiButton = (button) => {
    switch (button) {
        case MouseButton.Left:
            return 0;
        case MouseButton.Middle:
            return 1;
        case MouseButton.Right:
            return 2;
        case MouseButton.Back:
            return 3;
        case MouseButton.Forward:
            return 4;
    }
};
/**
 * @internal
 */
class BidiMouse extends Mouse {
    #page;
    #lastMovePoint = { x: 0, y: 0 };
    constructor(page) {
        super();
        this.#page = page;
    }
    async reset() {
        this.#lastMovePoint = { x: 0, y: 0 };
        await this.#page.mainFrame().browsingContext.releaseActions();
    }
    async move(x, y, options = {}) {
        const from = this.#lastMovePoint;
        const to = {
            x: Math.round(x),
            y: Math.round(y),
        };
        const actions = [];
        const steps = options.steps ?? 0;
        for (let i = 0; i < steps; ++i) {
            actions.push({
                type: ActionType.PointerMove,
                x: from.x + (to.x - from.x) * (i / steps),
                y: from.y + (to.y - from.y) * (i / steps),
                origin: options.origin,
            });
        }
        actions.push({
            type: ActionType.PointerMove,
            ...to,
            origin: options.origin,
        });
        // https://w3c.github.io/webdriver-bidi/#command-input-performActions:~:text=input.PointerMoveAction%20%3D%20%7B%0A%20%20type%3A%20%22pointerMove%22%2C%0A%20%20x%3A%20js%2Dint%2C
        this.#lastMovePoint = to;
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_mouse" /* InputId.Mouse */,
                actions,
            },
        ]);
    }
    async down(options = {}) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_mouse" /* InputId.Mouse */,
                actions: [
                    {
                        type: ActionType.PointerDown,
                        button: getBidiButton(options.button ?? MouseButton.Left),
                    },
                ],
            },
        ]);
    }
    async up(options = {}) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_mouse" /* InputId.Mouse */,
                actions: [
                    {
                        type: ActionType.PointerUp,
                        button: getBidiButton(options.button ?? MouseButton.Left),
                    },
                ],
            },
        ]);
    }
    async click(x, y, options = {}) {
        const actions = [
            {
                type: ActionType.PointerMove,
                x: Math.round(x),
                y: Math.round(y),
                origin: options.origin,
            },
        ];
        const pointerDownAction = {
            type: ActionType.PointerDown,
            button: getBidiButton(options.button ?? MouseButton.Left),
        };
        const pointerUpAction = {
            type: ActionType.PointerUp,
            button: pointerDownAction.button,
        };
        for (let i = 1; i < (options.count ?? 1); ++i) {
            actions.push(pointerDownAction, pointerUpAction);
        }
        actions.push(pointerDownAction);
        if (options.delay) {
            actions.push({
                type: ActionType.Pause,
                duration: options.delay,
            });
        }
        actions.push(pointerUpAction);
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_mouse" /* InputId.Mouse */,
                actions,
            },
        ]);
    }
    async wheel(options = {}) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Wheel,
                id: "__puppeteer_wheel" /* InputId.Wheel */,
                actions: [
                    {
                        type: ActionType.Scroll,
                        ...(this.#lastMovePoint ?? {
                            x: 0,
                            y: 0,
                        }),
                        deltaX: options.deltaX ?? 0,
                        deltaY: options.deltaY ?? 0,
                    },
                ],
            },
        ]);
    }
    drag() {
        throw new UnsupportedOperation();
    }
    dragOver() {
        throw new UnsupportedOperation();
    }
    dragEnter() {
        throw new UnsupportedOperation();
    }
    drop() {
        throw new UnsupportedOperation();
    }
    dragAndDrop() {
        throw new UnsupportedOperation();
    }
}
/**
 * @internal
 */
class BidiTouchscreen extends Touchscreen {
    #page;
    constructor(page) {
        super();
        this.#page = page;
    }
    async touchStart(x, y, options = {}) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_finger" /* InputId.Finger */,
                parameters: {
                    pointerType: "touch" /* Bidi.Input.PointerType.Touch */,
                },
                actions: [
                    {
                        type: ActionType.PointerMove,
                        x: Math.round(x),
                        y: Math.round(y),
                        origin: options.origin,
                    },
                    {
                        type: ActionType.PointerDown,
                        button: 0,
                        width: 0.5 * 2, // 2 times default touch radius.
                        height: 0.5 * 2, // 2 times default touch radius.
                        pressure: 0.5,
                        altitudeAngle: Math.PI / 2,
                    },
                ],
            },
        ]);
    }
    async touchMove(x, y, options = {}) {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_finger" /* InputId.Finger */,
                parameters: {
                    pointerType: "touch" /* Bidi.Input.PointerType.Touch */,
                },
                actions: [
                    {
                        type: ActionType.PointerMove,
                        x: Math.round(x),
                        y: Math.round(y),
                        origin: options.origin,
                        width: 0.5 * 2, // 2 times default touch radius.
                        height: 0.5 * 2, // 2 times default touch radius.
                        pressure: 0.5,
                        altitudeAngle: Math.PI / 2,
                    },
                ],
            },
        ]);
    }
    async touchEnd() {
        await this.#page.mainFrame().browsingContext.performActions([
            {
                type: SourceActionsType.Pointer,
                id: "__puppeteer_finger" /* InputId.Finger */,
                parameters: {
                    pointerType: "touch" /* Bidi.Input.PointerType.Touch */,
                },
                actions: [
                    {
                        type: ActionType.PointerUp,
                        button: 0,
                    },
                ],
            },
        ]);
    }
}

/**
 * @license
 * Copyright 2022 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __esDecorate$4 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers$4 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __addDisposableResource$2 = (undefined && undefined.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources$2 = (undefined && undefined.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        function next() {
            while (env.stack.length) {
                var rec = env.stack.pop();
                try {
                    var result = rec.dispose && rec.dispose.call(rec.value);
                    if (rec.async) return Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                }
                catch (e) {
                    fail(e);
                }
            }
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/**
 * Implements Page using WebDriver BiDi.
 *
 * @internal
 */
let BidiPage = (() => {
    let _classSuper = Page;
    let _trustedEmitter_decorators;
    let _trustedEmitter_initializers = [];
    let _trustedEmitter_extraInitializers = [];
    return class BidiPage extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _trustedEmitter_decorators = [bubble()];
            __esDecorate$4(this, null, _trustedEmitter_decorators, { kind: "accessor", name: "trustedEmitter", static: false, private: false, access: { has: obj => "trustedEmitter" in obj, get: obj => obj.trustedEmitter, set: (obj, value) => { obj.trustedEmitter = value; } }, metadata: _metadata }, _trustedEmitter_initializers, _trustedEmitter_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(browserContext, browsingContext) {
            const page = new BidiPage(browserContext, browsingContext);
            page.#initialize();
            return page;
        }
        #trustedEmitter_accessor_storage = __runInitializers$4(this, _trustedEmitter_initializers, new EventEmitter());
        get trustedEmitter() { return this.#trustedEmitter_accessor_storage; }
        set trustedEmitter(value) { this.#trustedEmitter_accessor_storage = value; }
        #browserContext = __runInitializers$4(this, _trustedEmitter_extraInitializers);
        #frame;
        #viewport = null;
        #workers = new Set();
        keyboard;
        mouse;
        touchscreen;
        tracing;
        coverage;
        #cdpEmulationManager;
        #emulatedNetworkConditions;
        _client() {
            return this.#frame.client;
        }
        constructor(browserContext, browsingContext) {
            super();
            this.#browserContext = browserContext;
            this.#frame = BidiFrame.from(this, browsingContext);
            this.#cdpEmulationManager = new EmulationManager(this.#frame.client);
            this.tracing = new Tracing(this.#frame.client);
            this.coverage = new Coverage(this.#frame.client);
            this.keyboard = new BidiKeyboard(this);
            this.mouse = new BidiMouse(this);
            this.touchscreen = new BidiTouchscreen(this);
        }
        #initialize() {
            this.#frame.browsingContext.on('closed', () => {
                this.trustedEmitter.emit("close" /* PageEvent.Close */, undefined);
                this.trustedEmitter.removeAllListeners();
            });
            this.trustedEmitter.on("workercreated" /* PageEvent.WorkerCreated */, worker => {
                this.#workers.add(worker);
            });
            this.trustedEmitter.on("workerdestroyed" /* PageEvent.WorkerDestroyed */, worker => {
                this.#workers.delete(worker);
            });
        }
        /**
         * @internal
         */
        _userAgentHeaders = {};
        #userAgentInterception;
        #userAgentPreloadScript;
        async setUserAgent(userAgent, userAgentMetadata) {
            if (!this.#browserContext.browser().cdpSupported && userAgentMetadata) {
                throw new UnsupportedOperation('Current Browser does not support `userAgentMetadata`');
            }
            else if (this.#browserContext.browser().cdpSupported &&
                userAgentMetadata) {
                return await this._client().send('Network.setUserAgentOverride', {
                    userAgent: userAgent,
                    userAgentMetadata: userAgentMetadata,
                });
            }
            const enable = userAgent !== '';
            userAgent = userAgent ?? (await this.#browserContext.browser().userAgent());
            this._userAgentHeaders = enable
                ? {
                    'User-Agent': userAgent,
                }
                : {};
            this.#userAgentInterception = await this.#toggleInterception(["beforeRequestSent" /* Bidi.Network.InterceptPhase.BeforeRequestSent */], this.#userAgentInterception, enable);
            const changeUserAgent = (userAgent) => {
                Object.defineProperty(navigator, 'userAgent', {
                    value: userAgent,
                });
            };
            const frames = [this.#frame];
            for (const frame of frames) {
                frames.push(...frame.childFrames());
            }
            if (this.#userAgentPreloadScript) {
                await this.removeScriptToEvaluateOnNewDocument(this.#userAgentPreloadScript);
            }
            const [evaluateToken] = await Promise.all([
                enable
                    ? this.evaluateOnNewDocument(changeUserAgent, userAgent)
                    : undefined,
                // When we disable the UserAgent we want to
                // evaluate the original value in all Browsing Contexts
                frames.map(frame => {
                    return frame.evaluate(changeUserAgent, userAgent);
                }),
            ]);
            this.#userAgentPreloadScript = evaluateToken?.identifier;
        }
        async setBypassCSP(enabled) {
            // TODO: handle CDP-specific cases such as mprach.
            await this._client().send('Page.setBypassCSP', { enabled });
        }
        async queryObjects(prototypeHandle) {
            assert(!prototypeHandle.disposed, 'Prototype JSHandle is disposed!');
            assert(prototypeHandle.id, 'Prototype JSHandle must not be referencing primitive value');
            const response = await this.#frame.client.send('Runtime.queryObjects', {
                prototypeObjectId: prototypeHandle.id,
            });
            return this.#frame.mainRealm().createHandle({
                type: 'array',
                handle: response.objects.objectId,
            });
        }
        browser() {
            return this.browserContext().browser();
        }
        browserContext() {
            return this.#browserContext;
        }
        mainFrame() {
            return this.#frame;
        }
        async focusedFrame() {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const handle = __addDisposableResource$2(env_1, (await this.mainFrame()
                    .isolatedRealm()
                    .evaluateHandle(() => {
                    let win = window;
                    while (win.document.activeElement instanceof win.HTMLIFrameElement ||
                        win.document.activeElement instanceof win.HTMLFrameElement) {
                        if (win.document.activeElement.contentWindow === null) {
                            break;
                        }
                        win = win.document.activeElement.contentWindow;
                    }
                    return win;
                })), false);
                const value = handle.remoteValue();
                assert(value.type === 'window');
                const frame = this.frames().find(frame => {
                    return frame._id === value.value.context;
                });
                assert(frame);
                return frame;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources$2(env_1);
            }
        }
        frames() {
            const frames = [this.#frame];
            for (const frame of frames) {
                frames.push(...frame.childFrames());
            }
            return frames;
        }
        isClosed() {
            return this.#frame.detached;
        }
        async close(options) {
            const env_2 = { stack: [], error: void 0, hasError: false };
            try {
                const _guard = __addDisposableResource$2(env_2, await this.#browserContext.waitForScreenshotOperations(), false);
                try {
                    await this.#frame.browsingContext.close(options?.runBeforeUnload);
                }
                catch {
                    return;
                }
            }
            catch (e_2) {
                env_2.error = e_2;
                env_2.hasError = true;
            }
            finally {
                __disposeResources$2(env_2);
            }
        }
        async reload(options = {}) {
            const [response] = await Promise.all([
                this.#frame.waitForNavigation(options),
                this.#frame.browsingContext.reload(),
            ]).catch(rewriteNavigationError(this.url(), options.timeout ?? this._timeoutSettings.navigationTimeout()));
            return response;
        }
        setDefaultNavigationTimeout(timeout) {
            this._timeoutSettings.setDefaultNavigationTimeout(timeout);
        }
        setDefaultTimeout(timeout) {
            this._timeoutSettings.setDefaultTimeout(timeout);
        }
        getDefaultTimeout() {
            return this._timeoutSettings.timeout();
        }
        isJavaScriptEnabled() {
            return this.#cdpEmulationManager.javascriptEnabled;
        }
        async setGeolocation(options) {
            return await this.#cdpEmulationManager.setGeolocation(options);
        }
        async setJavaScriptEnabled(enabled) {
            return await this.#cdpEmulationManager.setJavaScriptEnabled(enabled);
        }
        async emulateMediaType(type) {
            return await this.#cdpEmulationManager.emulateMediaType(type);
        }
        async emulateCPUThrottling(factor) {
            return await this.#cdpEmulationManager.emulateCPUThrottling(factor);
        }
        async emulateMediaFeatures(features) {
            return await this.#cdpEmulationManager.emulateMediaFeatures(features);
        }
        async emulateTimezone(timezoneId) {
            return await this.#cdpEmulationManager.emulateTimezone(timezoneId);
        }
        async emulateIdleState(overrides) {
            return await this.#cdpEmulationManager.emulateIdleState(overrides);
        }
        async emulateVisionDeficiency(type) {
            return await this.#cdpEmulationManager.emulateVisionDeficiency(type);
        }
        async setViewport(viewport) {
            if (!this.browser().cdpSupported) {
                await this.#frame.browsingContext.setViewport({
                    viewport: viewport?.width && viewport?.height
                        ? {
                            width: viewport.width,
                            height: viewport.height,
                        }
                        : null,
                    devicePixelRatio: viewport?.deviceScaleFactor
                        ? viewport.deviceScaleFactor
                        : null,
                });
                this.#viewport = viewport;
                return;
            }
            const needsReload = await this.#cdpEmulationManager.emulateViewport(viewport);
            this.#viewport = viewport;
            if (needsReload) {
                await this.reload();
            }
        }
        viewport() {
            return this.#viewport;
        }
        async pdf(options = {}) {
            const { timeout: ms = this._timeoutSettings.timeout(), path = undefined } = options;
            const { printBackground: background, margin, landscape, width, height, pageRanges: ranges, scale, preferCSSPageSize, } = parsePDFOptions(options, 'cm');
            const pageRanges = ranges ? ranges.split(', ') : [];
            await firstValueFrom(from(this.mainFrame()
                .isolatedRealm()
                .evaluate(() => {
                return document.fonts.ready;
            })).pipe(raceWith(timeout(ms))));
            const data = await firstValueFrom(from(this.#frame.browsingContext.print({
                background,
                margin,
                orientation: landscape ? 'landscape' : 'portrait',
                page: {
                    width,
                    height,
                },
                pageRanges,
                scale,
                shrinkToFit: !preferCSSPageSize,
            })).pipe(raceWith(timeout(ms))));
            const buffer = Buffer.from(data, 'base64');
            await this._maybeWriteBufferToFile(path, buffer);
            return buffer;
        }
        async createPDFStream(options) {
            const buffer = await this.pdf(options);
            return new ReadableStream({
                start(controller) {
                    controller.enqueue(buffer);
                    controller.close();
                },
            });
        }
        async _screenshot(options) {
            const { clip, type, captureBeyondViewport, quality } = options;
            if (options.omitBackground !== undefined && options.omitBackground) {
                throw new UnsupportedOperation(`BiDi does not support 'omitBackground'.`);
            }
            if (options.optimizeForSpeed !== undefined && options.optimizeForSpeed) {
                throw new UnsupportedOperation(`BiDi does not support 'optimizeForSpeed'.`);
            }
            if (options.fromSurface !== undefined && !options.fromSurface) {
                throw new UnsupportedOperation(`BiDi does not support 'fromSurface'.`);
            }
            if (clip !== undefined && clip.scale !== undefined && clip.scale !== 1) {
                throw new UnsupportedOperation(`BiDi does not support 'scale' in 'clip'.`);
            }
            let box;
            if (clip) {
                if (captureBeyondViewport) {
                    box = clip;
                }
                else {
                    // The clip is always with respect to the document coordinates, so we
                    // need to convert this to viewport coordinates when we aren't capturing
                    // beyond the viewport.
                    const [pageLeft, pageTop] = await this.evaluate(() => {
                        if (!window.visualViewport) {
                            throw new Error('window.visualViewport is not supported.');
                        }
                        return [
                            window.visualViewport.pageLeft,
                            window.visualViewport.pageTop,
                        ];
                    });
                    box = {
                        ...clip,
                        x: clip.x - pageLeft,
                        y: clip.y - pageTop,
                    };
                }
            }
            const data = await this.#frame.browsingContext.captureScreenshot({
                origin: captureBeyondViewport ? 'document' : 'viewport',
                format: {
                    type: `image/${type}`,
                    ...(quality !== undefined ? { quality: quality / 100 } : {}),
                },
                ...(box ? { clip: { type: 'box', ...box } } : {}),
            });
            return data;
        }
        async createCDPSession() {
            return await this.#frame.createCDPSession();
        }
        async bringToFront() {
            await this.#frame.browsingContext.activate();
        }
        async evaluateOnNewDocument(pageFunction, ...args) {
            const expression = evaluationExpression(pageFunction, ...args);
            const script = await this.#frame.browsingContext.addPreloadScript(expression);
            return { identifier: script };
        }
        async removeScriptToEvaluateOnNewDocument(id) {
            await this.#frame.browsingContext.removePreloadScript(id);
        }
        async exposeFunction(name, pptrFunction) {
            return await this.mainFrame().exposeFunction(name, 'default' in pptrFunction ? pptrFunction.default : pptrFunction);
        }
        isDragInterceptionEnabled() {
            return false;
        }
        async setCacheEnabled(enabled) {
            if (!this.#browserContext.browser().cdpSupported) {
                await this.#frame.browsingContext.setCacheBehavior(enabled ? 'default' : 'bypass');
                return;
            }
            // TODO: handle CDP-specific cases such as mprach.
            await this._client().send('Network.setCacheDisabled', {
                cacheDisabled: !enabled,
            });
        }
        async cookies(...urls) {
            const normalizedUrls = (urls.length ? urls : [this.url()]).map(url => {
                return new URL(url);
            });
            const cookies = await this.#frame.browsingContext.getCookies();
            return cookies
                .map(cookie => {
                return bidiToPuppeteerCookie(cookie);
            })
                .filter(cookie => {
                return normalizedUrls.some(url => {
                    return testUrlMatchCookie(cookie, url);
                });
            });
        }
        isServiceWorkerBypassed() {
            throw new UnsupportedOperation();
        }
        target() {
            throw new UnsupportedOperation();
        }
        waitForFileChooser() {
            throw new UnsupportedOperation();
        }
        workers() {
            return [...this.#workers];
        }
        #userInterception;
        async setRequestInterception(enable) {
            this.#userInterception = await this.#toggleInterception(["beforeRequestSent" /* Bidi.Network.InterceptPhase.BeforeRequestSent */], this.#userInterception, enable);
        }
        /**
         * @internal
         */
        _extraHTTPHeaders = {};
        #extraHeadersInterception;
        async setExtraHTTPHeaders(headers) {
            const extraHTTPHeaders = {};
            for (const [key, value] of Object.entries(headers)) {
                assert(isString(value), `Expected value of header "${key}" to be String, but "${typeof value}" is found.`);
                extraHTTPHeaders[key.toLowerCase()] = value;
            }
            this._extraHTTPHeaders = extraHTTPHeaders;
            this.#extraHeadersInterception = await this.#toggleInterception(["beforeRequestSent" /* Bidi.Network.InterceptPhase.BeforeRequestSent */], this.#extraHeadersInterception, Boolean(Object.keys(this._extraHTTPHeaders).length));
        }
        /**
         * @internal
         */
        _credentials = null;
        #authInterception;
        async authenticate(credentials) {
            this.#authInterception = await this.#toggleInterception(["authRequired" /* Bidi.Network.InterceptPhase.AuthRequired */], this.#authInterception, Boolean(credentials));
            this._credentials = credentials;
        }
        async #toggleInterception(phases, interception, expected) {
            if (expected && !interception) {
                return await this.#frame.browsingContext.addIntercept({
                    phases,
                });
            }
            else if (!expected && interception) {
                await this.#frame.browsingContext.userContext.browser.removeIntercept(interception);
                return;
            }
            return interception;
        }
        setDragInterception() {
            throw new UnsupportedOperation();
        }
        setBypassServiceWorker() {
            throw new UnsupportedOperation();
        }
        async setOfflineMode(enabled) {
            if (!this.#browserContext.browser().cdpSupported) {
                throw new UnsupportedOperation();
            }
            if (!this.#emulatedNetworkConditions) {
                this.#emulatedNetworkConditions = {
                    offline: false,
                    upload: -1,
                    download: -1,
                    latency: 0,
                };
            }
            this.#emulatedNetworkConditions.offline = enabled;
            return await this.#applyNetworkConditions();
        }
        async emulateNetworkConditions(networkConditions) {
            if (!this.#browserContext.browser().cdpSupported) {
                throw new UnsupportedOperation();
            }
            if (!this.#emulatedNetworkConditions) {
                this.#emulatedNetworkConditions = {
                    offline: false,
                    upload: -1,
                    download: -1,
                    latency: 0,
                };
            }
            this.#emulatedNetworkConditions.upload = networkConditions
                ? networkConditions.upload
                : -1;
            this.#emulatedNetworkConditions.download = networkConditions
                ? networkConditions.download
                : -1;
            this.#emulatedNetworkConditions.latency = networkConditions
                ? networkConditions.latency
                : 0;
            return await this.#applyNetworkConditions();
        }
        async #applyNetworkConditions() {
            if (!this.#emulatedNetworkConditions) {
                return;
            }
            await this._client().send('Network.emulateNetworkConditions', {
                offline: this.#emulatedNetworkConditions.offline,
                latency: this.#emulatedNetworkConditions.latency,
                uploadThroughput: this.#emulatedNetworkConditions.upload,
                downloadThroughput: this.#emulatedNetworkConditions.download,
            });
        }
        async setCookie(...cookies) {
            const pageURL = this.url();
            const pageUrlStartsWithHTTP = pageURL.startsWith('http');
            for (const cookie of cookies) {
                let cookieUrl = cookie.url || '';
                if (!cookieUrl && pageUrlStartsWithHTTP) {
                    cookieUrl = pageURL;
                }
                assert(cookieUrl !== 'about:blank', `Blank page can not have cookie "${cookie.name}"`);
                assert(!String.prototype.startsWith.call(cookieUrl || '', 'data:'), `Data URL page can not have cookie "${cookie.name}"`);
                const normalizedUrl = URL.canParse(cookieUrl)
                    ? new URL(cookieUrl)
                    : undefined;
                const domain = cookie.domain ?? normalizedUrl?.hostname;
                assert(domain !== undefined, `At least one of the url and domain needs to be specified`);
                const bidiCookie = {
                    domain: domain,
                    name: cookie.name,
                    value: {
                        type: 'string',
                        value: cookie.value,
                    },
                    ...(cookie.path !== undefined ? { path: cookie.path } : {}),
                    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
                    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
                    ...(cookie.sameSite !== undefined
                        ? { sameSite: convertCookiesSameSiteCdpToBiDi(cookie.sameSite) }
                        : {}),
                    ...(cookie.expires !== undefined ? { expiry: cookie.expires } : {}),
                    // Chrome-specific properties.
                    ...cdpSpecificCookiePropertiesFromPuppeteerToBidi(cookie, 'sameParty', 'sourceScheme', 'priority', 'url'),
                };
                if (cookie.partitionKey !== undefined) {
                    await this.browserContext().userContext.setCookie(bidiCookie, cookie.partitionKey);
                }
                else {
                    await this.#frame.browsingContext.setCookie(bidiCookie);
                }
            }
        }
        async deleteCookie(...cookies) {
            await Promise.all(cookies.map(async (deleteCookieRequest) => {
                const cookieUrl = deleteCookieRequest.url ?? this.url();
                const normalizedUrl = URL.canParse(cookieUrl)
                    ? new URL(cookieUrl)
                    : undefined;
                const domain = deleteCookieRequest.domain ?? normalizedUrl?.hostname;
                assert(domain !== undefined, `At least one of the url and domain needs to be specified`);
                const filter = {
                    domain: domain,
                    name: deleteCookieRequest.name,
                    ...(deleteCookieRequest.path !== undefined
                        ? { path: deleteCookieRequest.path }
                        : {}),
                };
                await this.#frame.browsingContext.deleteCookie(filter);
            }));
        }
        async removeExposedFunction(name) {
            await this.#frame.removeExposedFunction(name);
        }
        metrics() {
            throw new UnsupportedOperation();
        }
        async goBack(options = {}) {
            return await this.#go(-1, options);
        }
        async goForward(options = {}) {
            return await this.#go(1, options);
        }
        async #go(delta, options) {
            try {
                const [response] = await Promise.all([
                    this.waitForNavigation(options),
                    this.#frame.browsingContext.traverseHistory(delta),
                ]);
                return response;
            }
            catch (error) {
                // TODO: waitForNavigation should be cancelled if an error happens.
                if (isErrorLike(error)) {
                    if (error.message.includes('no such history entry')) {
                        return null;
                    }
                }
                throw error;
            }
        }
        waitForDevicePrompt() {
            throw new UnsupportedOperation();
        }
    };
})();
function evaluationExpression(fun, ...args) {
    return `() => {${evaluationString(fun, ...args)}}`;
}
/**
 * Check domains match.
 * According to cookies spec, this check should match subdomains as well, but CDP
 * implementation does not do that, so this method matches only the exact domains, not
 * what is written in the spec:
 * https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.3
 */
function testUrlMatchCookieHostname(cookie, normalizedUrl) {
    const cookieDomain = cookie.domain.toLowerCase();
    const urlHostname = normalizedUrl.hostname.toLowerCase();
    return cookieDomain === urlHostname;
}
/**
 * Check paths match.
 * Spec: https://datatracker.ietf.org/doc/html/rfc6265#section-5.1.4
 */
function testUrlMatchCookiePath(cookie, normalizedUrl) {
    const uriPath = normalizedUrl.pathname;
    const cookiePath = cookie.path;
    if (uriPath === cookiePath) {
        // The cookie-path and the request-path are identical.
        return true;
    }
    if (uriPath.startsWith(cookiePath)) {
        // The cookie-path is a prefix of the request-path.
        if (cookiePath.endsWith('/')) {
            // The last character of the cookie-path is %x2F ("/").
            return true;
        }
        if (uriPath[cookiePath.length] === '/') {
            // The first character of the request-path that is not included in the cookie-path
            // is a %x2F ("/") character.
            return true;
        }
    }
    return false;
}
/**
 * Checks the cookie matches the URL according to the spec:
 */
function testUrlMatchCookie(cookie, url) {
    const normalizedUrl = new URL(url);
    assert(cookie !== undefined);
    if (!testUrlMatchCookieHostname(cookie, normalizedUrl)) {
        return false;
    }
    return testUrlMatchCookiePath(cookie, normalizedUrl);
}
function bidiToPuppeteerCookie(bidiCookie) {
    return {
        name: bidiCookie.name,
        // Presents binary value as base64 string.
        value: bidiCookie.value.value,
        domain: bidiCookie.domain,
        path: bidiCookie.path,
        size: bidiCookie.size,
        httpOnly: bidiCookie.httpOnly,
        secure: bidiCookie.secure,
        sameSite: convertCookiesSameSiteBiDiToCdp(bidiCookie.sameSite),
        expires: bidiCookie.expiry ?? -1,
        session: bidiCookie.expiry === undefined || bidiCookie.expiry <= 0,
        // Extending with CDP-specific properties with `goog:` prefix.
        ...cdpSpecificCookiePropertiesFromBidiToPuppeteer(bidiCookie, 'sameParty', 'sourceScheme', 'partitionKey', 'partitionKeyOpaque', 'priority'),
    };
}
const CDP_SPECIFIC_PREFIX = 'goog:';
/**
 * Gets CDP-specific properties from the BiDi cookie and returns them as a new object.
 */
function cdpSpecificCookiePropertiesFromBidiToPuppeteer(bidiCookie, ...propertyNames) {
    const result = {};
    for (const property of propertyNames) {
        if (bidiCookie[CDP_SPECIFIC_PREFIX + property] !== undefined) {
            result[property] = bidiCookie[CDP_SPECIFIC_PREFIX + property];
        }
    }
    return result;
}
/**
 * Gets CDP-specific properties from the cookie, adds CDP-specific prefixes and returns
 * them as a new object which can be used in BiDi.
 */
function cdpSpecificCookiePropertiesFromPuppeteerToBidi(cookieParam, ...propertyNames) {
    const result = {};
    for (const property of propertyNames) {
        if (cookieParam[property] !== undefined) {
            result[CDP_SPECIFIC_PREFIX + property] = cookieParam[property];
        }
    }
    return result;
}
function convertCookiesSameSiteBiDiToCdp(sameSite) {
    return sameSite === 'strict' ? 'Strict' : sameSite === 'lax' ? 'Lax' : 'None';
}
function convertCookiesSameSiteCdpToBiDi(sameSite) {
    return sameSite === 'Strict'
        ? "strict" /* Bidi.Network.SameSite.Strict */
        : sameSite === 'Lax'
            ? "lax" /* Bidi.Network.SameSite.Lax */
            : "none" /* Bidi.Network.SameSite.None */;
}

/**
 * @license
 * Copyright 2023 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @internal
 */
class BidiBrowserTarget extends Target {
    #browser;
    constructor(browser) {
        super();
        this.#browser = browser;
    }
    asPage() {
        throw new UnsupportedOperation();
    }
    url() {
        return '';
    }
    createCDPSession() {
        throw new UnsupportedOperation();
    }
    type() {
        return TargetType.BROWSER;
    }
    browser() {
        return this.#browser;
    }
    browserContext() {
        return this.#browser.defaultBrowserContext();
    }
    opener() {
        throw new UnsupportedOperation();
    }
}
/**
 * @internal
 */
class BidiPageTarget extends Target {
    #page;
    constructor(page) {
        super();
        this.#page = page;
    }
    async page() {
        return this.#page;
    }
    async asPage() {
        return BidiPage.from(this.browserContext(), this.#page.mainFrame().browsingContext);
    }
    url() {
        return this.#page.url();
    }
    createCDPSession() {
        return this.#page.createCDPSession();
    }
    type() {
        return TargetType.PAGE;
    }
    browser() {
        return this.browserContext().browser();
    }
    browserContext() {
        return this.#page.browserContext();
    }
    opener() {
        throw new UnsupportedOperation();
    }
}
/**
 * @internal
 */
class BidiFrameTarget extends Target {
    #frame;
    #page;
    constructor(frame) {
        super();
        this.#frame = frame;
    }
    async page() {
        if (this.#page === undefined) {
            this.#page = BidiPage.from(this.browserContext(), this.#frame.browsingContext);
        }
        return this.#page;
    }
    async asPage() {
        return BidiPage.from(this.browserContext(), this.#frame.browsingContext);
    }
    url() {
        return this.#frame.url();
    }
    createCDPSession() {
        return this.#frame.createCDPSession();
    }
    type() {
        return TargetType.PAGE;
    }
    browser() {
        return this.browserContext().browser();
    }
    browserContext() {
        return this.#frame.page().browserContext();
    }
    opener() {
        throw new UnsupportedOperation();
    }
}
/**
 * @internal
 */
class BidiWorkerTarget extends Target {
    #worker;
    constructor(worker) {
        super();
        this.#worker = worker;
    }
    async page() {
        throw new UnsupportedOperation();
    }
    async asPage() {
        throw new UnsupportedOperation();
    }
    url() {
        return this.#worker.url();
    }
    createCDPSession() {
        throw new UnsupportedOperation();
    }
    type() {
        return TargetType.OTHER;
    }
    browser() {
        return this.browserContext().browser();
    }
    browserContext() {
        return this.#worker.frame.page().browserContext();
    }
    opener() {
        throw new UnsupportedOperation();
    }
}

/**
 * @license
 * Copyright 2022 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __esDecorate$3 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers$3 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __addDisposableResource$1 = (undefined && undefined.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources$1 = (undefined && undefined.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        function next() {
            while (env.stack.length) {
                var rec = env.stack.pop();
                try {
                    var result = rec.dispose && rec.dispose.call(rec.value);
                    if (rec.async) return Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                }
                catch (e) {
                    fail(e);
                }
            }
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/**
 * @internal
 */
let BidiBrowserContext = (() => {
    let _classSuper = BrowserContext;
    let _trustedEmitter_decorators;
    let _trustedEmitter_initializers = [];
    let _trustedEmitter_extraInitializers = [];
    return class BidiBrowserContext extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _trustedEmitter_decorators = [bubble()];
            __esDecorate$3(this, null, _trustedEmitter_decorators, { kind: "accessor", name: "trustedEmitter", static: false, private: false, access: { has: obj => "trustedEmitter" in obj, get: obj => obj.trustedEmitter, set: (obj, value) => { obj.trustedEmitter = value; } }, metadata: _metadata }, _trustedEmitter_initializers, _trustedEmitter_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static from(browser, userContext, options) {
            const context = new BidiBrowserContext(browser, userContext, options);
            context.#initialize();
            return context;
        }
        #trustedEmitter_accessor_storage = __runInitializers$3(this, _trustedEmitter_initializers, new EventEmitter());
        get trustedEmitter() { return this.#trustedEmitter_accessor_storage; }
        set trustedEmitter(value) { this.#trustedEmitter_accessor_storage = value; }
        #browser = __runInitializers$3(this, _trustedEmitter_extraInitializers);
        #defaultViewport;
        // This is public because of cookies.
        userContext;
        #pages = new WeakMap();
        #targets = new Map();
        #overrides = [];
        constructor(browser, userContext, options) {
            super();
            this.#browser = browser;
            this.userContext = userContext;
            this.#defaultViewport = options.defaultViewport;
        }
        #initialize() {
            // Create targets for existing browsing contexts.
            for (const browsingContext of this.userContext.browsingContexts) {
                this.#createPage(browsingContext);
            }
            this.userContext.on('browsingcontext', ({ browsingContext }) => {
                const page = this.#createPage(browsingContext);
                // We need to wait for the DOMContentLoaded as the
                // browsingContext still may be navigating from the about:blank
                browsingContext.once('DOMContentLoaded', () => {
                    if (browsingContext.originalOpener) {
                        for (const context of this.userContext.browsingContexts) {
                            if (context.id === browsingContext.originalOpener) {
                                this.#pages
                                    .get(context)
                                    .trustedEmitter.emit("popup" /* PageEvent.Popup */, page);
                            }
                        }
                    }
                });
            });
            this.userContext.on('closed', () => {
                this.trustedEmitter.removeAllListeners();
            });
        }
        #createPage(browsingContext) {
            const page = BidiPage.from(this, browsingContext);
            this.#pages.set(browsingContext, page);
            page.trustedEmitter.on("close" /* PageEvent.Close */, () => {
                this.#pages.delete(browsingContext);
            });
            // -- Target stuff starts here --
            const pageTarget = new BidiPageTarget(page);
            const pageTargets = new Map();
            this.#targets.set(page, [pageTarget, pageTargets]);
            page.trustedEmitter.on("frameattached" /* PageEvent.FrameAttached */, frame => {
                const bidiFrame = frame;
                const target = new BidiFrameTarget(bidiFrame);
                pageTargets.set(bidiFrame, target);
                this.trustedEmitter.emit("targetcreated" /* BrowserContextEvent.TargetCreated */, target);
            });
            page.trustedEmitter.on("framenavigated" /* PageEvent.FrameNavigated */, frame => {
                const bidiFrame = frame;
                const target = pageTargets.get(bidiFrame);
                // If there is no target, then this is the page's frame.
                if (target === undefined) {
                    this.trustedEmitter.emit("targetchanged" /* BrowserContextEvent.TargetChanged */, pageTarget);
                }
                else {
                    this.trustedEmitter.emit("targetchanged" /* BrowserContextEvent.TargetChanged */, target);
                }
            });
            page.trustedEmitter.on("framedetached" /* PageEvent.FrameDetached */, frame => {
                const bidiFrame = frame;
                const target = pageTargets.get(bidiFrame);
                if (target === undefined) {
                    return;
                }
                pageTargets.delete(bidiFrame);
                this.trustedEmitter.emit("targetdestroyed" /* BrowserContextEvent.TargetDestroyed */, target);
            });
            page.trustedEmitter.on("workercreated" /* PageEvent.WorkerCreated */, worker => {
                const bidiWorker = worker;
                const target = new BidiWorkerTarget(bidiWorker);
                pageTargets.set(bidiWorker, target);
                this.trustedEmitter.emit("targetcreated" /* BrowserContextEvent.TargetCreated */, target);
            });
            page.trustedEmitter.on("workerdestroyed" /* PageEvent.WorkerDestroyed */, worker => {
                const bidiWorker = worker;
                const target = pageTargets.get(bidiWorker);
                if (target === undefined) {
                    return;
                }
                pageTargets.delete(worker);
                this.trustedEmitter.emit("targetdestroyed" /* BrowserContextEvent.TargetDestroyed */, target);
            });
            page.trustedEmitter.on("close" /* PageEvent.Close */, () => {
                this.#targets.delete(page);
                this.trustedEmitter.emit("targetdestroyed" /* BrowserContextEvent.TargetDestroyed */, pageTarget);
            });
            this.trustedEmitter.emit("targetcreated" /* BrowserContextEvent.TargetCreated */, pageTarget);
            // -- Target stuff ends here --
            return page;
        }
        targets() {
            return [...this.#targets.values()].flatMap(([target, frames]) => {
                return [target, ...frames.values()];
            });
        }
        async newPage() {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const _guard = __addDisposableResource$1(env_1, await this.waitForScreenshotOperations(), false);
                const context = await this.userContext.createBrowsingContext("tab" /* Bidi.BrowsingContext.CreateType.Tab */);
                const page = this.#pages.get(context);
                if (!page) {
                    throw new Error('Page is not found');
                }
                if (this.#defaultViewport) {
                    try {
                        await page.setViewport(this.#defaultViewport);
                    }
                    catch {
                        // No support for setViewport in Firefox.
                    }
                }
                return page;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources$1(env_1);
            }
        }
        async close() {
            if (!this.isIncognito()) {
                throw new Error('Default context cannot be closed!');
            }
            try {
                await this.userContext.remove();
            }
            catch (error) {
                debugError(error);
            }
            this.#targets.clear();
        }
        browser() {
            return this.#browser;
        }
        async pages() {
            return [...this.userContext.browsingContexts].map(context => {
                return this.#pages.get(context);
            });
        }
        isIncognito() {
            return this.userContext.id !== UserContext.DEFAULT;
        }
        async overridePermissions(origin, permissions) {
            const permissionsSet = new Set(permissions.map(permission => {
                const protocolPermission = WEB_PERMISSION_TO_PROTOCOL_PERMISSION.get(permission);
                if (!protocolPermission) {
                    throw new Error('Unknown permission: ' + permission);
                }
                return permission;
            }));
            await Promise.all(Array.from(WEB_PERMISSION_TO_PROTOCOL_PERMISSION.keys()).map(permission => {
                const result = this.userContext.setPermissions(origin, {
                    name: permission,
                }, permissionsSet.has(permission)
                    ? "granted" /* Bidi.Permissions.PermissionState.Granted */
                    : "denied" /* Bidi.Permissions.PermissionState.Denied */);
                this.#overrides.push({ origin, permission });
                // TODO: some permissions are outdated and setting them to denied does
                // not work.
                if (!permissionsSet.has(permission)) {
                    return result.catch(debugError);
                }
                return result;
            }));
        }
        async clearPermissionOverrides() {
            const promises = this.#overrides.map(({ permission, origin }) => {
                return this.userContext
                    .setPermissions(origin, {
                    name: permission,
                }, "prompt" /* Bidi.Permissions.PermissionState.Prompt */)
                    .catch(debugError);
            });
            this.#overrides = [];
            await Promise.all(promises);
        }
        get id() {
            if (this.userContext.id === UserContext.DEFAULT) {
                return undefined;
            }
            return this.userContext.id;
        }
    };
})();

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$2 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$2 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __addDisposableResource = (undefined && undefined.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (undefined && undefined.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        function next() {
            while (env.stack.length) {
                var rec = env.stack.pop();
                try {
                    var result = rec.dispose && rec.dispose.call(rec.value);
                    if (rec.async) return Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                }
                catch (e) {
                    fail(e);
                }
            }
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/**
 * @internal
 */
let Browser = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _dispose_decorators;
    let _close_decorators;
    let _addPreloadScript_decorators;
    let _removeIntercept_decorators;
    let _removePreloadScript_decorators;
    let _createUserContext_decorators;
    return class Browser extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$2(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$2(this, null, _close_decorators, { kind: "method", name: "close", static: false, private: false, access: { has: obj => "close" in obj, get: obj => obj.close }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$2(this, null, _addPreloadScript_decorators, { kind: "method", name: "addPreloadScript", static: false, private: false, access: { has: obj => "addPreloadScript" in obj, get: obj => obj.addPreloadScript }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$2(this, null, _removeIntercept_decorators, { kind: "method", name: "removeIntercept", static: false, private: false, access: { has: obj => "removeIntercept" in obj, get: obj => obj.removeIntercept }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$2(this, null, _removePreloadScript_decorators, { kind: "method", name: "removePreloadScript", static: false, private: false, access: { has: obj => "removePreloadScript" in obj, get: obj => obj.removePreloadScript }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$2(this, null, _createUserContext_decorators, { kind: "method", name: "createUserContext", static: false, private: false, access: { has: obj => "createUserContext" in obj, get: obj => obj.createUserContext }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static async from(session) {
            const browser = new Browser(session);
            await browser.#initialize();
            return browser;
        }
        #closed = (__runInitializers$2(this, _instanceExtraInitializers), false);
        #reason;
        #disposables = new DisposableStack();
        #userContexts = new Map();
        session;
        #sharedWorkers = new Map();
        constructor(session) {
            super();
            this.session = session;
        }
        async #initialize() {
            const sessionEmitter = this.#disposables.use(new EventEmitter(this.session));
            sessionEmitter.once('ended', ({ reason }) => {
                this.dispose(reason);
            });
            sessionEmitter.on('script.realmCreated', info => {
                if (info.type !== 'shared-worker') {
                    return;
                }
                this.#sharedWorkers.set(info.realm, SharedWorkerRealm.from(this, info.realm, info.origin));
            });
            await this.#syncUserContexts();
            await this.#syncBrowsingContexts();
        }
        async #syncUserContexts() {
            const { result: { userContexts }, } = await this.session.send('browser.getUserContexts', {});
            for (const context of userContexts) {
                this.#createUserContext(context.userContext);
            }
        }
        async #syncBrowsingContexts() {
            // In case contexts are created or destroyed during `getTree`, we use this
            // set to detect them.
            const contextIds = new Set();
            let contexts;
            {
                const env_1 = { stack: [], error: void 0, hasError: false };
                try {
                    const sessionEmitter = __addDisposableResource(env_1, new EventEmitter(this.session), false);
                    sessionEmitter.on('browsingContext.contextCreated', info => {
                        contextIds.add(info.context);
                    });
                    const { result } = await this.session.send('browsingContext.getTree', {});
                    contexts = result.contexts;
                }
                catch (e_1) {
                    env_1.error = e_1;
                    env_1.hasError = true;
                }
                finally {
                    __disposeResources(env_1);
                }
            }
            // Simulating events so contexts are created naturally.
            for (const info of contexts) {
                if (!contextIds.has(info.context)) {
                    this.session.emit('browsingContext.contextCreated', info);
                }
                if (info.children) {
                    contexts.push(...info.children);
                }
            }
        }
        #createUserContext(id) {
            const userContext = UserContext.create(this, id);
            this.#userContexts.set(userContext.id, userContext);
            const userContextEmitter = this.#disposables.use(new EventEmitter(userContext));
            userContextEmitter.once('closed', () => {
                userContextEmitter.removeAllListeners();
                this.#userContexts.delete(userContext.id);
            });
            return userContext;
        }
        get closed() {
            return this.#closed;
        }
        get defaultUserContext() {
            // SAFETY: A UserContext is always created for the default context.
            return this.#userContexts.get(UserContext.DEFAULT);
        }
        get disconnected() {
            return this.#reason !== undefined;
        }
        get disposed() {
            return this.disconnected;
        }
        get userContexts() {
            return this.#userContexts.values();
        }
        dispose(reason, closed = false) {
            this.#closed = closed;
            this.#reason = reason;
            this[disposeSymbol]();
        }
        async close() {
            try {
                await this.session.send('browser.close', {});
            }
            finally {
                this.dispose('Browser already closed.', true);
            }
        }
        async addPreloadScript(functionDeclaration, options = {}) {
            const { result: { script }, } = await this.session.send('script.addPreloadScript', {
                functionDeclaration,
                ...options,
                contexts: options.contexts?.map(context => {
                    return context.id;
                }),
            });
            return script;
        }
        async removeIntercept(intercept) {
            await this.session.send('network.removeIntercept', {
                intercept,
            });
        }
        async removePreloadScript(script) {
            await this.session.send('script.removePreloadScript', {
                script,
            });
        }
        async createUserContext() {
            const { result: { userContext: context }, } = await this.session.send('browser.createUserContext', {});
            return this.#createUserContext(context);
        }
        [(_dispose_decorators = [inertIfDisposed], _close_decorators = [throwIfDisposed(browser => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return browser.#reason;
            })], _addPreloadScript_decorators = [throwIfDisposed(browser => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return browser.#reason;
            })], _removeIntercept_decorators = [throwIfDisposed(browser => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return browser.#reason;
            })], _removePreloadScript_decorators = [throwIfDisposed(browser => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return browser.#reason;
            })], _createUserContext_decorators = [throwIfDisposed(browser => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return browser.#reason;
            })], disposeSymbol)]() {
            this.#reason ??=
                'Browser was disconnected, probably because the session ended.';
            if (this.closed) {
                this.emit('closed', { reason: this.#reason });
            }
            this.emit('disconnected', { reason: this.#reason });
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();

/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __runInitializers$1 = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate$1 = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
// TODO: Once Chrome supports session.status properly, uncomment this block.
// const MAX_RETRIES = 5;
/**
 * @internal
 */
let Session = (() => {
    let _classSuper = EventEmitter;
    let _instanceExtraInitializers = [];
    let _connection_decorators;
    let _connection_initializers = [];
    let _connection_extraInitializers = [];
    let _dispose_decorators;
    let _send_decorators;
    let _subscribe_decorators;
    let _addIntercepts_decorators;
    let _end_decorators;
    return class Session extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate$1(this, null, _connection_decorators, { kind: "accessor", name: "connection", static: false, private: false, access: { has: obj => "connection" in obj, get: obj => obj.connection, set: (obj, value) => { obj.connection = value; } }, metadata: _metadata }, _connection_initializers, _connection_extraInitializers);
            __esDecorate$1(this, null, _dispose_decorators, { kind: "method", name: "dispose", static: false, private: false, access: { has: obj => "dispose" in obj, get: obj => obj.dispose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$1(this, null, _send_decorators, { kind: "method", name: "send", static: false, private: false, access: { has: obj => "send" in obj, get: obj => obj.send }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$1(this, null, _subscribe_decorators, { kind: "method", name: "subscribe", static: false, private: false, access: { has: obj => "subscribe" in obj, get: obj => obj.subscribe }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$1(this, null, _addIntercepts_decorators, { kind: "method", name: "addIntercepts", static: false, private: false, access: { has: obj => "addIntercepts" in obj, get: obj => obj.addIntercepts }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate$1(this, null, _end_decorators, { kind: "method", name: "end", static: false, private: false, access: { has: obj => "end" in obj, get: obj => obj.end }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static async from(connection, capabilities) {
            // Wait until the session is ready.
            //
            // TODO: Once Chrome supports session.status properly, uncomment this block
            // and remove `getBiDiConnection` in BrowserConnector.
            // let status = {message: '', ready: false};
            // for (let i = 0; i < MAX_RETRIES; ++i) {
            //   status = (await connection.send('session.status', {})).result;
            //   if (status.ready) {
            //     break;
            //   }
            //   // Backoff a little bit each time.
            //   await new Promise(resolve => {
            //     return setTimeout(resolve, (1 << i) * 100);
            //   });
            // }
            // if (!status.ready) {
            //   throw new Error(status.message);
            // }
            const { result } = await connection.send('session.new', {
                capabilities,
            });
            const session = new Session(connection, result);
            await session.#initialize();
            return session;
        }
        #reason = __runInitializers$1(this, _instanceExtraInitializers);
        #disposables = new DisposableStack();
        #info;
        browser;
        #connection_accessor_storage = __runInitializers$1(this, _connection_initializers, void 0);
        get connection() { return this.#connection_accessor_storage; }
        set connection(value) { this.#connection_accessor_storage = value; }
        constructor(connection, info) {
            super();
            __runInitializers$1(this, _connection_extraInitializers);
            this.#info = info;
            this.connection = connection;
        }
        async #initialize() {
            // SAFETY: We use `any` to allow assignment of the readonly property.
            this.browser = await Browser.from(this);
            const browserEmitter = this.#disposables.use(this.browser);
            browserEmitter.once('closed', ({ reason }) => {
                this.dispose(reason);
            });
            // TODO: Currently, some implementations do not emit navigationStarted event
            // for fragment navigations (as per spec) and some do. This could emits a
            // synthetic navigationStarted to work around this inconsistency.
            const seen = new WeakSet();
            this.on('browsingContext.fragmentNavigated', info => {
                if (seen.has(info)) {
                    return;
                }
                seen.add(info);
                this.emit('browsingContext.navigationStarted', info);
                this.emit('browsingContext.fragmentNavigated', info);
            });
        }
        get capabilities() {
            return this.#info.capabilities;
        }
        get disposed() {
            return this.ended;
        }
        get ended() {
            return this.#reason !== undefined;
        }
        get id() {
            return this.#info.sessionId;
        }
        dispose(reason) {
            this.#reason = reason;
            this[disposeSymbol]();
        }
        /**
         * Currently, there is a 1:1 relationship between the session and the
         * session. In the future, we might support multiple sessions and in that
         * case we always needs to make sure that the session for the right session
         * object is used, so we implement this method here, although it's not defined
         * in the spec.
         */
        async send(method, params) {
            return await this.connection.send(method, params);
        }
        async subscribe(events, contexts) {
            await this.send('session.subscribe', {
                events,
                contexts,
            });
        }
        async addIntercepts(events, contexts) {
            await this.send('session.subscribe', {
                events,
                contexts,
            });
        }
        async end() {
            try {
                await this.send('session.end', {});
            }
            finally {
                this.dispose(`Session already ended.`);
            }
        }
        [(_connection_decorators = [bubble()], _dispose_decorators = [inertIfDisposed], _send_decorators = [throwIfDisposed(session => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return session.#reason;
            })], _subscribe_decorators = [throwIfDisposed(session => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return session.#reason;
            })], _addIntercepts_decorators = [throwIfDisposed(session => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return session.#reason;
            })], _end_decorators = [throwIfDisposed(session => {
                // SAFETY: By definition of `disposed`, `#reason` is defined.
                return session.#reason;
            })], disposeSymbol)]() {
            this.#reason ??=
                'Session already destroyed, probably because the connection broke.';
            this.emit('ended', { reason: this.#reason });
            this.#disposables.dispose();
            super[disposeSymbol]();
        }
    };
})();

/**
 * @license
 * Copyright 2022 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */
var __esDecorate = (undefined && undefined.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (undefined && undefined.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (undefined && undefined.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
/**
 * @internal
 */
let BidiBrowser = (() => {
    let _classSuper = Browser$1;
    let _private_trustedEmitter_decorators;
    let _private_trustedEmitter_initializers = [];
    let _private_trustedEmitter_extraInitializers = [];
    let _private_trustedEmitter_descriptor;
    return class BidiBrowser extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _private_trustedEmitter_decorators = [bubble()];
            __esDecorate(this, _private_trustedEmitter_descriptor = { get: __setFunctionName(function () { return this.#trustedEmitter_accessor_storage; }, "#trustedEmitter", "get"), set: __setFunctionName(function (value) { this.#trustedEmitter_accessor_storage = value; }, "#trustedEmitter", "set") }, _private_trustedEmitter_decorators, { kind: "accessor", name: "#trustedEmitter", static: false, private: true, access: { has: obj => #trustedEmitter in obj, get: obj => obj.#trustedEmitter, set: (obj, value) => { obj.#trustedEmitter = value; } }, metadata: _metadata }, _private_trustedEmitter_initializers, _private_trustedEmitter_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        protocol = 'webDriverBiDi';
        // TODO: Update generator to include fully module
        static subscribeModules = [
            'browsingContext',
            'network',
            'log',
            'script',
        ];
        static subscribeCdpEvents = [
            // Coverage
            'cdp.Debugger.scriptParsed',
            'cdp.CSS.styleSheetAdded',
            'cdp.Runtime.executionContextsCleared',
            // Tracing
            'cdp.Tracing.tracingComplete',
            // TODO: subscribe to all CDP events in the future.
            'cdp.Network.requestWillBeSent',
            'cdp.Debugger.scriptParsed',
            'cdp.Page.screencastFrame',
        ];
        static async create(opts) {
            const session = await Session.from(opts.connection, {
                alwaysMatch: {
                    acceptInsecureCerts: opts.ignoreHTTPSErrors,
                    webSocketUrl: true,
                },
            });
            await session.subscribe(session.capabilities.browserName.toLocaleLowerCase().includes('firefox')
                ? BidiBrowser.subscribeModules
                : [...BidiBrowser.subscribeModules, ...BidiBrowser.subscribeCdpEvents]);
            const browser = new BidiBrowser(session.browser, opts);
            browser.#initialize();
            return browser;
        }
        #trustedEmitter_accessor_storage = __runInitializers(this, _private_trustedEmitter_initializers, new EventEmitter());
        get #trustedEmitter() { return _private_trustedEmitter_descriptor.get.call(this); }
        set #trustedEmitter(value) { return _private_trustedEmitter_descriptor.set.call(this, value); }
        #process = __runInitializers(this, _private_trustedEmitter_extraInitializers);
        #closeCallback;
        #browserCore;
        #defaultViewport;
        #browserContexts = new WeakMap();
        #target = new BidiBrowserTarget(this);
        constructor(browserCore, opts) {
            super();
            this.#process = opts.process;
            this.#closeCallback = opts.closeCallback;
            this.#browserCore = browserCore;
            this.#defaultViewport = opts.defaultViewport;
        }
        #initialize() {
            // Initializing existing contexts.
            for (const userContext of this.#browserCore.userContexts) {
                this.#createBrowserContext(userContext);
            }
            this.#browserCore.once('disconnected', () => {
                this.#trustedEmitter.emit("disconnected" /* BrowserEvent.Disconnected */, undefined);
                this.#trustedEmitter.removeAllListeners();
            });
            this.#process?.once('close', () => {
                this.#browserCore.dispose('Browser process exited.', true);
                this.connection.dispose();
            });
        }
        get #browserName() {
            return this.#browserCore.session.capabilities.browserName;
        }
        get #browserVersion() {
            return this.#browserCore.session.capabilities.browserVersion;
        }
        get cdpSupported() {
            return !this.#browserName.toLocaleLowerCase().includes('firefox');
        }
        async userAgent() {
            return this.#browserCore.session.capabilities.userAgent;
        }
        #createBrowserContext(userContext) {
            const browserContext = BidiBrowserContext.from(this, userContext, {
                defaultViewport: this.#defaultViewport,
            });
            this.#browserContexts.set(userContext, browserContext);
            browserContext.trustedEmitter.on("targetcreated" /* BrowserContextEvent.TargetCreated */, target => {
                this.#trustedEmitter.emit("targetcreated" /* BrowserEvent.TargetCreated */, target);
            });
            browserContext.trustedEmitter.on("targetchanged" /* BrowserContextEvent.TargetChanged */, target => {
                this.#trustedEmitter.emit("targetchanged" /* BrowserEvent.TargetChanged */, target);
            });
            browserContext.trustedEmitter.on("targetdestroyed" /* BrowserContextEvent.TargetDestroyed */, target => {
                this.#trustedEmitter.emit("targetdestroyed" /* BrowserEvent.TargetDestroyed */, target);
            });
            return browserContext;
        }
        get connection() {
            // SAFETY: We only have one implementation.
            return this.#browserCore.session.connection;
        }
        wsEndpoint() {
            return this.connection.url;
        }
        async close() {
            if (this.connection.closed) {
                return;
            }
            try {
                await this.#browserCore.close();
                await this.#closeCallback?.call(null);
            }
            catch (error) {
                // Fail silently.
                debugError(error);
            }
            finally {
                this.connection.dispose();
            }
        }
        get connected() {
            return !this.#browserCore.disconnected;
        }
        process() {
            return this.#process ?? null;
        }
        async createBrowserContext(_options) {
            const userContext = await this.#browserCore.createUserContext();
            return this.#createBrowserContext(userContext);
        }
        async version() {
            return `${this.#browserName}/${this.#browserVersion}`;
        }
        browserContexts() {
            return [...this.#browserCore.userContexts].map(context => {
                return this.#browserContexts.get(context);
            });
        }
        defaultBrowserContext() {
            return this.#browserContexts.get(this.#browserCore.defaultUserContext);
        }
        newPage() {
            return this.defaultBrowserContext().newPage();
        }
        targets() {
            return [
                this.#target,
                ...this.browserContexts().flatMap(context => {
                    return context.targets();
                }),
            ];
        }
        target() {
            return this.#target;
        }
        async disconnect() {
            try {
                await this.#browserCore.session.end();
            }
            catch (error) {
                // Fail silently.
                debugError(error);
            }
            finally {
                this.connection.dispose();
            }
        }
        get debugInfo() {
            return {
                pendingProtocolErrors: this.connection.getPendingProtocolErrors(),
            };
        }
    };
})();

export { BidiBrowser, BidiBrowserContext, BidiConnection, BidiElementHandle, BidiFrame, BidiFrameRealm, BidiHTTPRequest, BidiHTTPResponse, BidiJSHandle, BidiKeyboard, BidiMouse, BidiPage, BidiRealm, BidiTouchscreen, BidiWorkerRealm, connectBidiOverCdp, requests };
