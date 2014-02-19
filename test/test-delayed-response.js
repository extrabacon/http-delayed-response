var express = require('express');
var request = require('supertest');
var fs = require('fs');
var when = require('when');
var DelayedResponse = require('../');
require('should');

describe('DelayedResponse', function () {
    describe('.start(interval, initialDelay)', function () {
        it('should return a callback handler', function (done) {
            var app = express();
            app.use(function (req, res) {
                var delayed = new DelayedResponse(req, res);
                delayed.start().should.be.a.Function;
                res.end();
            });
            request(app).get('/').expect(202, done);
        });
        it('should poll at the specified interval', function (done) {
            var app = express();
            var pollCount = 0;
            app.use(function (req, res) {
                var delayed = new DelayedResponse(req, res);
                delayed.on('poll', function () {
                    pollCount++;
                });
                setTimeout(delayed.start(10), 100);
            });
            request(app).get('/').end(function () {
                pollCount.should.be.exactly(8);
                done();
            });
        });
        it('should poll after the initial delay', function (done) {
            var app = express();
            var pollCount = 0;
            app.use(function (req, res) {
                var delayed = new DelayedResponse(req, res);
                delayed.on('poll', function () {
                    pollCount++;
                });
                setTimeout(delayed.start(10, 50), 100);
            });
            request(app).get('/').end(function () {
                pollCount.should.be.exactly(4);
                done();
            });
        });
        it('should throw when started twice', function (done) {
            var app = express();
            app.use(function (req, res) {
                var delayed = new DelayedResponse(req, res);
                delayed.start();
                (function () {
                    delayed.start();
                }).should.throw('instance already started');
                delayed.end();
            });
            request(app).get('/').expect(202, done);
        });
    });
    describe('.stop()', function () {
        it('should stop polling', function (done) {
            var app = express();
            app.use(function (req, res) {
                var delayed = new DelayedResponse(req, res);
                delayed.start(10);
                setTimeout(function () {
                    delayed.stop();
                    res.end();
                }, 100);
            });
            request(app).get('/').expect(202, done);
        });
        it('should stop polling when request is aborted', function (done) {
            var app = express();
            app.use(function (req, res) {
                var delayed = new DelayedResponse(req, res);
                delayed.on('abort', function () {
                    res.end();
                    done();
                }).start();
            });
            var req = request(app).get('/').end();
            setTimeout(function () {
                req.abort();
            }, 100);
        });
    });
    describe('.end(err, data)', function () {
        describe('with default behavior', function () {
            it('should render text when ending with a string', function (done) {
                var app = express();
                app.use(function (req, res) {
                    var delayed = new DelayedResponse(req, res);
                    delayed.start(100, 0);
                    setTimeout(function () {
                        delayed.end(null, 'results');
                    }, 200);
                });
                request(app).get('/')
                    .end(function (err, res) {
                        if (err) return done(err);
                        res.text.should.be.exactly(' results');
                        done();
                    });
            });
            it('should render buffer contents when ending with a Buffer', function (done) {
                var app = express();
                app.use(function (req, res) {
                    var delayed = new DelayedResponse(req, res);
                    delayed.start(100, 0);
                    setTimeout(function () {
                        delayed.end(null, new Buffer('cmVzdWx0cw==', 'base64'));
                    }, 200);
                });
                request(app).get('/')
                    .end(function (err, res) {
                        if (err) return done(err);
                        res.text.should.be.exactly(' results');
                        done();
                    });
            });
            it('should pipe streams when ending with a readable stream', function (done) {
                var app = express();
                app.use(function (req, res) {
                    var delayed = new DelayedResponse(req, res);
                    delayed.start(100, 0);
                    setTimeout(function () {
                        delayed.end(null, fs.createReadStream('README.md'));
                    }, 200);
                });
                request(app).get('/')
                    .end(function (err, res) {
                        if (err) return done(err);
                        res.text.should.match(/\s+\# http-delayed-response/);
                        done();
                    });
            });
            it('should render JSON when ending with an object', function (done) {
                var app = express();
                app.use(function (req, res) {
                    res.set('Content-Type', 'application/json');
                    var delayed = new DelayedResponse(req, res);
                    delayed.start(100, 0);
                    setTimeout(function () {
                        delayed.end(null, { success: true });
                    }, 200);
                });
                request(app).get('/')
                    .expect({ success: true })
                    .end(done);
            });
            it('should throw an error when ending with error', function (done) {
                var app = express();
                app.use(function (req, res) {
                    var delayed = new DelayedResponse(req, res);
                    delayed.start();
                    setTimeout(function () {
                        (function () {
                            delayed.end(new Error('failure'));
                        }).should.throw('failure');
                        done();
                    }, 100);
                });
                request(app).get('/').end(function () {});
            });
        });
        describe('with promises', function () {
            it('should wait for promise resolution', function (done) {
                var app = express();
                app.use(function (req, res) {
                    res.set('Content-Type', 'application/json');
                    var delayed = new DelayedResponse(req, res);
                    delayed.start(100, 0);
                    var promise = when.resolve({ success: true });
                    delayed.end(promise);
                });
                request(app).get('/')
                    .expect({ success: true })
                    .end(done);
            });
            it('should wait for promise rejection', function (done) {
                var app = express();
                app.use(function (req, res) {
                    res.set('Content-Type', 'application/json');
                    var delayed = new DelayedResponse(req, res);
                    delayed.start(100, 0);
                    var promise = when.reject(new Error('failure'));
                    delayed.end(promise).catch(function (err) {
                        err.should.be.an.Error;
                        err.message.should.be.exactly('failure');
                        res.end();
                        done();
                    });
                });
                request(app).get('/').end(function () {});
            });
        });
        describe('with event handlers', function () {
            it('should fire a "done" event when ending normally', function (done) {
                var app = express();
                app.use(function (req, res) {
                    var delayed = new DelayedResponse(req, res);
                    delayed.on('done', function (data) {
                        data.should.be.exactly('results');
                        res.end();
                        done();
                    });
                    delayed.start();
                    setTimeout(function () {
                        delayed.end(null, 'results');
                    }, 100);
                });
                request(app).get('/').expect(202).end(function () {});
            });
            it('should fire an "error" event when ending with an error', function (done) {
                var app = express();
                app.use(function (req, res) {
                    var delayed = new DelayedResponse(req, res);
                    delayed.on('error', function (err) {
                        err.should.be.an.Error;
                        err.message.should.be.exactly('failure');
                        res.end();
                        done();
                    });
                    delayed.start();
                    setTimeout(function () {
                        (function () {
                            delayed.end(new Error('failure'));
                        }).should.not.throw();
                    }, 100);
                });
                request(app).get('/').end(function () {});
            });
        });
        describe('when used as middleware', function () {
            it('should invoke the error handler when ending with an error', function (done) {
                var app = express();
                app.use(function (req, res, next) {
                    var delayed = new DelayedResponse(req, res, next);
                    delayed.start();
                    setTimeout(function () {
                        (function () {
                            delayed.end(new Error('failure'));
                        }).should.not.throw();
                    }, 100);
                });
                app.use(function (err, req, res, next) {
                    err.should.be.an.Error;
                    err.message.should.be.exactly('failure');
                    res.status(500).end();
                });
                request(app).get('/').expect(500).end(done);
            });
        });
        describe('with promises', function () {

        });
    });
});
