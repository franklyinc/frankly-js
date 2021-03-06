/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Frankly Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
'use strict'

var _map = require('lodash/collection/map')
var querystring = require('querystring')
var http = require('http')
var https = require('https')
var Promise = require('promise')
var Cookie = require('./cookie.js')
var UserAgent = require('./useragent.js')
var Error = require('./error.js')
var normalize = require('./normalize.js')
var denormalize = require('./denormalize.js')

function operation (method) {
  switch (method) {
    case undefined: return 'read'
    case 'GET':     return 'read'
    case 'POST':    return 'create'
    case 'PUT':     return 'update'
    case 'DELETE':  return 'delete'
    default:        return 'unknown'
  }
}

function toBuffer (ab) {
  var buffer = new Buffer(ab.byteLength)
  var view = new Uint8Array(ab)
  var i = 0

  for (; i < buffer.length; ++i) {
    buffer[i] = view[i]
  }

  return buffer
}

function request (options, data) {
  var request = undefined

  switch (options.protocol) {
    case undefined:
      request = http.request
      break

    case 'http:':
      request = http.request
      break

    case 'https:':
      request = https.request
      break

    default:
      throw new Error("protocol must be 'http', 'https or undefined to submit http requests: found " + options.protocol)
  }

  if (options.headers === undefined) {
    options.headers = { }
  }

  if (options.headers['user-agent'] === undefined) {
    options.headers['user-agent'] = UserAgent
  }

  if (options.headers['accept'] === undefined) {
    options.headers['accept'] = 'application/json'
  }

  if (options.cookies !== undefined) {
    options.headers['cookie'] = _map(options.cookies, Cookie.format)
  }

  options.withCredentials = true

  return new Promise(function (resolve, reject) {
    var filereader = undefined

    function onInputReady () {
      var req = undefined

      options.headers['content-length'] = data.length

      // Node JS's http and https modules don't support params. Add support for it.
      if (options.params && options.path) {
        options.path += '?' + querystring.stringify(options.params)
        delete options['params']
      }

      req = request(options)

      if (options.timeout !== undefined) {
        // http-browserify doesn't support this method yet:
        // based on https://github.com/substack/http-browserify/pull/80
        if (req.setTimeout === undefined) {
          req.xhr.ontimeout = req.emit.bind(req, 'timeout')
          req.xhr.timeout = options.timeout
        } else {
          req.setTimeout(options.timeout)
        }
      }

      req.on('response', function (res) {
        var content = undefined
        var cookies = undefined

        try {
          cookies = res.headers['set-cookie']

          if (cookies === undefined) {
            cookies = []
          }

          delete res.headers['set-cookie']
        } catch (e) {
          cookies = []
        }

        res.cookies = Cookie.parse(cookies)

        res.on('data', function (chunk) {
          if (content === undefined) {
            content = '' + chunk
          } else {
            content += chunk
          }
        })

        res.on('end', function () {
          try {
            if (content !== undefined && res.headers['content-type'] === 'application/json') {
              content = normalize(JSON.parse(content))
            }
          } catch (e) {
            reject(Error.make(operation(options.method), options.path, 500, e.message))
            return
          }

          if ((res.statusCode >= 200) && (res.statusCode < 300)) {
            res.content = content
            resolve(res)
          } else {
            reject(Error.make(operation(options.method), options.path, res.statusCode, content))
          }
        })
      })

      req.on('error', function (e) {
        reject(Error.make(operation(options.method), options.path, 500, e.message))
      })

      req.on('timeout', function () {
        reject(Error.make(operation(options.method), options.path, 408, 'request timed out'))
      })

      req.write(data)
      req.end()
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      // Convert to ArrayBuffer that http module understands
      filereader = new FileReader()
      filereader.onload = function () {
        data = toBuffer(filereader.result)
        onInputReady()
      }
      filereader.onerror = function () {
        reject(filereader.error)
      }
      filereader.readAsArrayBuffer(data)
    } else {
      if (!(data instanceof Buffer)) {
        if (data instanceof ArrayBuffer) {
          data = toBuffer(data)
        } else {
          data = (data === undefined) ? '' : JSON.stringify(denormalize(data))
          options.headers['content-type'] = 'application/json'
        }
      }

      onInputReady()
    }
  })
}

module.exports = {
  request: request,

  del: function (options) {
    options.method = 'DELETE'
    return request(options)
  },

  get: function (options) {
    options.method = 'GET'
    return request(options)
  },

  post: function (options, data) {
    options.method = 'POST'
    return request(options, data)
  },

  put: function (options, data) {
    options.method = 'PUT'
    return request(options, data)
  },
}
