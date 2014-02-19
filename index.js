var stream = require('stream');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

/**
 * Creates a new DelayedResponse instance, wrapping an HTTP DelayedResponse.
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
    this.res.statusCode = 202;
    this.next = next;
    this.heartbeatChar = ' ';

    // if request is aborted, end the response immediately
    req.on('close', function () {
        abort.call(delayed);
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
 * Starts the polling process, keeping the connection alive.
 * @param  {Number} interval     The interval at which "heartbeat" events are emitted
 * @param  {Number} initialDelay The initial delay before starting the polling process
 * @return {Function}            The callback handler to use to end the delayed response (same as DelayedResponse.end).
 */
DelayedResponse.prototype.start = function (interval, initialDelay) {

    if (this.started) throw new Error('instance already started');

    var delayed = this;
    interval = interval || 100;
    initialDelay = typeof initialDelay === 'undefined' ? interval : initialDelay;

    // disable socket buffering - make sure all content is sent immediately
    this.res.socket.setNoDelay();

    // start the polling timer
    setTimeout(function () {
        delayed.pollingTimer = setInterval(heartbeat.bind(delayed), interval);
    }, initialDelay);
    this.started = true;

    return this.end.bind(delayed);
};

function heartbeat() {
    // always emit "poll" event
    this.emit('poll');
    if (this.listeners('heartbeat').length) {
        return this.emit('heartbeat');
    }
    // default behavior: write the heartbeat character (a space by default)
    this.res.write(this.heartbeatChar);
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

    // prevent double processing
    if (this.stopped) return;

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

    // stop the polling timer
    this.stop();

    // handle an error
    if (err) {
        if (this.listeners('error').length) {
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
 * Stops this delayed response without impacting the HTTP response.
 */
DelayedResponse.prototype.stop = function () {
    // restore socket buffering
    this.res.socket.setNoDelay(false);
    // stop polling
    clearInterval(this.pollingTimer);
    this.stopped = true;
};

module.exports = DelayedResponse;
