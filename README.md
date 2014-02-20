# http-delayed-response

A fast and easy way to delay a response until results are available. Use this module to respond appropriately with status [HTTP 202 Accepted](http://en.wikipedia.org/wiki/List_of_HTTP_status_codes#2xx_Success) when the result cannot be determined within an acceptable delay. Supports HTTP long-polling for longer delays, ensuring the connection stays alive until the result is available for working around platform limitations such as error H12 on Heroku or connection errors from aggressive firewalls.

Works with any Node HTTP server based on [ClientRequest](http://nodejs.org/api/http.html#http_class_http_clientrequest) and [ServerResponse](http://nodejs.org/api/http.html#http_class_http_serverresponse), including Express applications (can be used as standard middleware).

Note: This module is purely experimental and is not ready for production use.

## Installation

```bash
npm install http-delayed-response
```

To run the tests:
```bash
npm test
```

This module has no dependencies.

## Features

For simplicity, all examples are depicted as Express middleware.

### Waiting for a function to invoke its callback

This example waits for a slow function indefinitely, rendering its return value into the response. The `wait` method returns a callback that you can use to handle results.

```js

function slowFunction (callback) {
  // let's do something that could take a while...
}

app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  slowFunction(delayed.wait());
});
```

### Using promises instead of callbacks

Same thing, except the function returns a promise instead of invoking a callback. Use the `end` method to handle promises.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  delayed.wait();
  var promise = slowFunction();
  // will eventually end when the promise is fulfilled
  delayed.end(promise);
});
```

### Handling results and timeouts

Use the "done" event to handle the response when the function returns successfully within the allocated time. Otherwise, use the "cancel" event to handle the response. During a timeout, the response is automatically set to status 202.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);

  delayed.on('done', function (results) {
    // slowFunction responded within 5 seconds
    res.json(results);
  }).on('cancel', function () {
    // slowFunction failed to invoke its callback within 5 seconds
    // response has been set to HTTP 202
    res.write('sorry, this will take longer than expected...');
    res.end();
  });

  slowFunction(delayed.wait(5000));
});
```

### Extended delays and long-polling

If the function takes even longer to complete, we might face connectivity issues. For example, Heroku aborts the request if not a single byte is written within 30 seconds. To counter this situation, activate long-polling to keep the connection alive while waiting on the results. Use the `start` method instead of `wait` to periodically write non-significant bytes to the response.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  // verySlowFunction can now run indefinitely
  verySlowFunction(delayed.start());
});
```

Long-polling is continuously writing spaces (char \x20) to the response body in order to prevent connection termination. Remember that using long-polling makes handling the response a little different, since HTTP status 202 and headers are already sent to the client.

### Rendering JSON with long-polling

You are responsible for writing headers before enabling long-polling. If the return value needs to be rendered as JSON, set "Content-Type" beforehand, or use the `json` method as a shortcut.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  // shortcut for res.setHeader('Content-Type', 'application/json')
  delayed.json();
  // start activates long-polling - headers must be set before
  verySlowFunction(delayed.start());
});
```

### Polling a database

When long-polling is enabled, use the "poll" event to monitor a condition for ending the response. This example polls a MongoDB collection with Mongoose until a particular document is returned. The resulting document is rendered in the response as JSON.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);

  delayed.json().on('poll', function () {
    // "poll" event will occur every 5 seconds
    Model.findOne({ /* criteria */}, function (err, result) {
      if (err) {
        // end with an error
        delayed.end(err);
      } else if (result) {
        // end with the resulting document
        delayed.end(null, result);
      }
    });
  }).start(5000);

});
```

### Handling the response

By default, the callback result is rendered into the response body. More precisely:
  - when returning `null` or `undefined`, the response is ended with no additional content
  - when returning a `string` or a `Buffer`, it is written as-is
  - when returning a readable stream, the result is piped into the response
  - when returning anything else, the result is rendered using `JSON.stringify`

It is possible to handle the response manually if the default behavior is not appropriate. Be careful: headers are necessarily already sent when the "done" handler is called. When handling the response manually, you are responsible for ending it appropriately.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);

  delayed.on('done', function (data) {
    // handle "data" anyway you want, but don't forget to end the response!
    res.end();
  });

  slowFunction(delayed.wait());

});
```

### Handling errors

To handle errors, use the "error" event. Otherwise, unhandled errors will be thrown. Timeouts that are not handled with a "cancel" event are treated like normal errors. When using long-polling, HTTP status 202 is already applied and the HTTP protocol has no mechanism to indicate an error past this point. Also, when handling errors, you are responsible for ending the response.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);

  delayed.on('error', function (err) {
    // handle error here
    // timeout will also raise an error since there is no "cancel" handler
  });

  slowFunction(delayed.wait(5000));

});
```

Errors can also be handled with Connect or Express middleware by supplying the `next` parameter to the constructor.

```js
app.use(function (req, res, next) {
  var delayed = new DelayedResponse(req, res, next);
  // "next" will be invoked if "slowFunction" fails or take longer than 1 second to return
  slowFunction(delayed.wait(1000));
});
```

### Handling aborted requests

By default, a response is ended with no additional content if the client aborts the request before completion. If you need to handle an aborted request, attach the "abort" event. When handling client disconnects, you are responsible for ending the response.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);

  delayed.on('abort', function (err) {
    // handle client disconnection
    res.end();
  });

  // wait indefinitely - client might get bored...
  slowFunction(delayed.wait());

});
```

### Keeping the connection alive with long-polling

By default, when using long-polling, the connection is kept alive by writing a single space to the response at the specified interval (default is 100msec).

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  // write a "\x20" every second, until function is completed
  verySlowFunction(delayed.start(1000));
});
```

An initial delay before the first byte can also be specified (default is also 100msec).

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  // write a "\x20" every second after 10 seconds, until function is completed
  verySlowFunction(delayed.start(1000, 10000));
});
```

To avoid H12 errors in Heroku, initial delay must be under 30 seconds and at least 1 byte must be written every 55 seconds. See https://devcenter.heroku.com/articles/request-timeout for more details.

To manually keep the connection alive, attach the "heartbeat" event.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  delayed.on('heartbeat', function () {
    // anything you need to do to keep the connection alive
  });
  verySlowFunction(delayed.start(1000));
});
```

## API Reference

#### DelayedResponse(req, res, next)

Creates a `DelayedResponse` instance. Parameters represent the usual middleware signature.

#### DelayedResponse.wait(timeout)

Returns a callback handler that must be invoked within the allocated time represented by `timeout`.

The returned handler is the same as calling `DelayedResponse.end`.

#### DelayedResponse.start(interval, initialDelay, timeout)

Starts long-polling for the delayed response, sending headers and HTTP status 202.

Polling will occur at the specified `interval`, starting after `initialDelay`.

Returns a callback handler, same as `DelayedResponse.end`.

#### DelayedResponse.end(err, data)

Stops waiting, sending the contents represented by `data` in the response - or invoke the error handler if an error is present.

#### DelayedResponse.stop()

Stops monitoring timers without affecting the response.

#### DelayedResponse.json()

Shortcut for setting the "Content-Type" header to "application/json". Returns itself for chaining calls.

#### Event: 'done'

Fired when `end` is invoked without an error. If this event is not handled, the callback result is written in the response.

#### Event: 'error'

Fired when `end` is invoked with an error. If this event is not handled, the error is thrown as an uncaught error.

#### Event: 'cancel'

Fired when `end` failed to be invoked within the allocated time. If this event is not handled, the timeout is considered a normal error that can be handled using the `error` event.

#### Event: 'abort'

Fired when the request is closed.

#### Event: 'poll'

Fired continuously at the specified interval when invoking `start`.

#### Event: 'heartbeat'

Fired continuously at the specified interval when invoking `start`. Can be used to override the "keep-alive" mechanism.

## Compatibility

+ Tested with Node 0.10.x
+ Tested on Mac OS X 10.8

## License

The MIT License (MIT)

Copyright (c) 2013, Nicolas Mercier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
