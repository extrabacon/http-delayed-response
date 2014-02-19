# http-delayed-response

A fast and easy way to delay a response with HTTP long-polling, making sure the connection stays alive until the data to send is available. Use this module to prevent request timeouts on platforms such as Heroku (error H12) or connection errors on aggressive firewalls.

The module replaces your standard response with a long-polling [HTTP 202](http://en.wikipedia.org/wiki/List_of_HTTP_status_codes#2xx_Success) response, waiting on either a callback or a promise. The connection is kept alive by writing non-significant bytes to the response at a given interval.

Works with any Node.js HTTP server, including Express applications (can be used as standard middleware). This module has no dependencies.

```js
// without http-delayed-response
app.use(function (req, res) {
  // if getData takes longer than 30 seconds, Heroku will close the connection with error H12
  getData(function (err, data) {
    res.json(data);
  });
});

// with http-delayed-response
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  res.set('Content-Type', 'application/json');
  // when calling "start", bytes are written periodically to keep the connection alive
  // since bytes written are insignificant, the response can still be parsed as JSON
  getData(delayed.start());
});
```

Note: This module is experimental and is not ready for production use.

## Installation

```bash
npm install http-delayed-response
```

To run the tests:
```bash
npm test
```

## Examples

For simplicity, all examples are depicted as Express middleware. However, any Node.js HTTP server based on http.ClientRequest and http.ServerResponse is supported.

### Waiting for a very long function to invoke its callback

This example waits for a very slow function, rendering its return value into the response.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  verySlowFunction(delayed.start());
});
```

### Using promises instead of callbacks

Same thing, except that `verySlowFunction` returns a promise.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  delayed.start();
  var promise = verySlowFunction();
  delayed.end(promise);
});
```

### Rendering JSON

You are responsible for writing headers before starting the delayed response. If the returned data needs to be rendered as JSON, set the "content-type" header beforehand.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  res.set('Content-Type', 'application/json');
  // starting will write to the body - headers must be set before
  verySlowFunction(delayed.start());
});
```

### Polling with Mongoose

This example polls a MongoDB collection with Mongoose until a particular document is returned. The resulting document is rendered in the response as JSON. The "poll" event is used to periodically query the database.

```js
app.use(function (req, res) {
  res.set('Content-Type', 'application/json');
  var delayed = new DelayedResponse(req, res);

  delayed.on('poll', function () {
    // "poll" event will occur every 5 seconds
    Model.findOne({ /* criteria */}, function (err, result) {
      if (result) {
        delayed.end(null, result);
      }
    });
  }).start(5000);

});
```

### Handling the response

By default, the callback result is rendered into the response body. More precisely,
  - when returning null or undefined, the response is ended with no additional content
  - when returning a string or a buffer, result is written as-is
  - when returning a readable stream, the result is piped into the response
  - when returning anything else, the result is rendered using `JSON.stringify`

It is possible to handle the response manually if the default behavior is not appropriate. Be careful: only the body of the response can be written to, since headers are necessarily already sent. When handling the response manually, you are responsible for ending the response.

```js
app.use(function (req, res) {
  res.set('Content-Type', 'application/json');
  var delayed = new DelayedResponse(req, res);

  delayed.on('done', function (data) {
    // handle "data" anyway you want, but do not forget to end the response!
    res.end();
  }).start();

});
```

### Handling errors

To handle errors, simply subscribe to the "error" event, as unhandled errors will be thrown. Remember that HTTP status 202 is already applied and the HTTP protocol has no mechanism to indicate an error past this point. When handling errors, you are responsible for ending the response.

```js
app.use(function (req, res) {
  res.set('Content-Type', 'application/json');
  var delayed = new DelayedResponse(req, res);

  delayed.on('error', function (err) {
    // write a JSON error, assuming the client can interpret the result
    var error = { error: 'server_error', details: 'An error occurred on the server' };
    res.end(JSON.stringify(error));
  }).start();

});
```

Errors can also be handled with Express middleware by supplying the `next` parameter to the constructor.

```js
app.use(function (req, res, next) {
  res.set('Content-Type', 'application/json');
  var delayed = new DelayedResponse(req, res, next);
  // "next" will be invoked if "verySlowFunction" fails
  verySlowFunction(delayed.start(1000));
});
```

### Handling aborted requests

By default, a response is ended with no additional content if the client aborts the request before completion. If you need to handle an aborted request, simply subscribe to the "abort" event. When handling client disconnects, you are responsible for ending the response.

```js
app.use(function (req, res) {
  res.set('Content-Type', 'application/json');
  var delayed = new DelayedResponse(req, res);

  delayed.on('abort', function (err) {
    // handle client disconnection
    res.end();
  }).start();

});
```

### Keeping the connection alive

By default, the connection is kept alive by writing a single space to the response at the specified interval (default is 100msec).

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  // write a "\x20" every second
  verySlowFunction(delayed.start(1000));
});
```

An initial delay before the first byte can also be specified.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  // write a "\x20" every second after 10 seconds
  verySlowFunction(delayed.start(1000, 10000));
});
```

To avoid H12 errors in Heroku, initial delay must be under 30 seconds and polling must then occur under 55 seconds. See https://devcenter.heroku.com/articles/request-timeout for more details.

To manually keep the connection alive, subscribe to the "heartbeat" event.

```js
app.use(function (req, res) {
  var delayed = new DelayedResponse(req, res);
  delayed.on('heartbeat', function () {
    // anything you need to do to keep the connection alive - will be called every second
  });
  verySlowFunction(delayed.start(1000));
});
```

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
