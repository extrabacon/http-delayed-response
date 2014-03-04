var stream = require('stream');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var TimeoutError = function () {
    var err = Error.apply(this, arguments);
    this.stack = err.stack;
    this.message = err.message;
    return this;
};

/**
 * Creates a new DelayedResponse instance.
 *
 * @param {http.ClientRequest}   req  The incoming HTTP request
 * @param {http.ServerResponse}  res  The HTTP response to delay
 * @param {Function}             next The next function to invoke, when DelayedResponse is used as middleware with
 *                                    express or connect.
 */
var DelayedResponse = function (req, res, next) {

    if (!req) throw new Error('req is required');
    if (!res) throw new Error('res is required');

    var delayed = this;
    this.req = req;
    this.res = res;
    this.next = next;
    this.timers = {};

    // if request is aborted, end the response immediately
    req.on('close', function () {
        abort.call(delayed);
    });
    // make sure timers stop if response is ended or closed
    res.on('close', function () {
        delayed.stop();
    }).on('finish', function () {
        delayed.stop();
    });

    EventEmitter.call(this);
};
util.inherits(DelayedResponse, EventEmitter);

/**
 * Shorthand for adding the "Content-Type" header for returning JSON.
 * @return {DelayedResponse} The same instance, for chaining calls
 */
DelayedResponse.prototype.json = function () {
    this.res.setHeader('Content-Type', 'application/json');
    return this;
};

/**
 * Waits for callback results without long-polling.
 *
 * @param  {Number} timeout The maximum amount of time to wait before cancelling
 * @return {Function}       The callback handler to use to end the delayed response (same as DelayedResponse.end).
 */
DelayedResponse.prototype.wait = function (timeout) {

    if (this.started) throw new Error('instance already started');
    var delayed = this;

    // setup the cancel timer
    if (timeout) {
        this.timers.timeout = setTimeout(function () {
            // timeout implies status is unknown, set HTTP Accepted status
            delayed.res.statusCode = 202;
            delayed.end(new TimeoutError('timeout occurred'));
        }, timeout);
    }

    return this.end.bind(delayed);
};

/**
 * Starts long-polling to keep the connection alive while waiting for the callback results.
 * Also sets the response to status code 202 (Accepted).
 *
 * @param  {Number} interval     The interval at which "heartbeat" events are emitted
 * @param  {Number} initialDelay The initial delay before starting the polling process
 * @param  {Number} timeout      The maximum amount of time to wait before cancelling
 * @return {Function}            The callback handler to use to end the delayed response (same as DelayedResponse.end).
 */
DelayedResponse.prototype.start = function (interval, initialDelay, timeout) {

    if (this.started) throw new Error('instance already started');

    var delayed = this;
    interval = interval || 100;
    initialDelay = typeof initialDelay === 'undefined' ? interval : initialDelay;

    // set HTTP Accepted status code
    this.res.statusCode = 202;

    // disable socket buffering: make sure content is flushed immediately during long-polling
    this.res.socket && this.res.socket.setNoDelay();

    // start the polling and initial delay timers
    this.timers.initialDelay = setTimeout(function () {
        delayed.timers.poll = setInterval(heartbeat.bind(delayed), interval);
    }, initialDelay);
    this.started = true;

    // setup the cancel timer
    if (timeout) {
        this.timers.timeout = setTimeout(function () {
            delayed.end(new TimeoutError('timeout occurred'));
        }, timeout);
    }

    return this.end.bind(delayed);
};

function heartbeat() {
    // always emit "poll" event
    this.emit('poll');
    // if "heartbeat" event is attached, delegate to handlers
    if (this.listeners('heartbeat').length) {
        return this.emit('heartbeat');
    }
    // default behavior: write the heartbeat character (a space)
    this.res.write(' ');
}

function abort() {
    this.stop();
    if (this.listeners('abort').length) {
        return this.emit('abort');
    }
    // default behavior: end the response with no fanfare
    this.res.end();
}

/**
 * Ends this delayed response, writing the contents to the HTTP response and ending it. Attach a handler on the "done"
 * event to manually end the response, or "error" to manually handle the error.
 *
 * @param  {Error} err   The error to throw if the operation has failed.
 * @param  {*}     data  The return value to render in the response.
 */
DelayedResponse.prototype.end = function (err, data) {

    // detect a promise-like object
    if (err && 'then' in err && typeof err.then === 'function') {
        var promise = err;
        var delayed = this;
        return promise.then(function (result) {
            delayed.end(null, result);
            return result;
        }, function (err) {
            // this will throw err
            delayed.end(err);
        });
    }

    // prevent double processing
    if (this.ended) return console.warn('DelayedResponse.end has been called twice!');
    this.ended = true;

    // restore socket buffering
    this.res.socket && this.res.socket.setNoDelay(false);

    // handle an error
    if (err) {
        if (err instanceof TimeoutError && this.listeners('cancel').length) {
            return this.emit('cancel');
        } else if (this.listeners('error').length) {
            return this.emit('error', err);
        } else if (this.next) {
            return this.next(err);
        }
        throw err;
    }

    // if "done" handlers are attached, they are in charge of ending the response
    if (this.listeners('done').length) {
        return this.emit('done', data);
    }

    // otherwise, end the response with default behavior
    if (typeof data === 'undefined' || data === null) {
        this.res.end();
    } else if (data instanceof stream.Readable) {
        data.pipe(this.res);
    } else if (typeof data === 'string' || Buffer.isBuffer(data)) {
        this.res.end(data);
    } else {
        this.res.end(JSON.stringify(data));
    }
};

/**
 * Stops long-polling without affecting the response.
 */
DelayedResponse.prototype.stop = function () {
    // stop initial delay
    clearTimeout(this.timers.initialDelay);
    this.timers.initialDelay = null;
    // stop polling
    clearInterval(this.timers.poll);
    this.timers.poll = null;
    // stop timeout
    clearTimeout(this.timers.timeout);
    this.timers.timeout = null;
};

module.exports = DelayedResponse;
