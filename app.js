global.PORT = (process.env.PORT || 80);

var express = require('express');
var nunjucks = require('nunjucks');
var async = require('async');
var todolist = require('todo-list');
var _ = require('underscore');
var _request = require('request');
var levelup = require('level');

// Setup cache
var db = levelup('./cache');

/**
 * Checks that cache for a given key. If the key has
 * an associated value, it is immediately passed to proceed.
 * If the key is not in the cache, we call generate_data
 * which creates the data, puts it in the cache, and calls proceed.
 * @param {string} key - The key of this data in the cache
 * @param generate_data - A function that should generate the data.
 *     It is passed a callback, of prototype function(err, data)
 * @param proceed - a function(err, data), which proceeds with the data
 */
function check_cache(key, generate_data, proceed) {
  db.get(key, function (err, value) {
    if (err) {
      generate_data(function(err, data) {
        if(err) {
          proceed(err);
        } else {
          db.put(key, data);
          proceed(null, data);
        }
      });
    } else {
      proceed(null, JSON.parse(value));
    }
  });
}

// GitHub API Client
var githubapi = require("github");
var github = new githubapi({
  version: "3.0.0",
  protocol: "https",
  host: "api.github.com"
});

var app = express();
var server = require('http').Server(app);

nunjucks.configure('templates', {
  autoescape: true,
  express: app,
  watch: true
});

app.use(express.static('public'));

function get_context(code, line) {
  var lines = code.split(/\r*\n/);
  var CONTEXT = 4;
  var start = _.max([0, line - CONTEXT])
  var end = _.min([lines.length - 1, line + CONTEXT])
  return lines.slice(start, end).join('\n');
}

function render_list(user, repo, items, request, response) {
  items_by_type = _.groupBy(items, "type");
  items_by_file = _.groupBy(items, "file");
  response.render('repo.html', {
    user: user,
    repo: repo,
    items_by_type:  items_by_type,
    items_by_file: items_by_file
  });
}

// Route that access the tip of the default branch
app.get('/:user/:repo', function(request, response) {
  github.repos.get({
    user: request.params.user,
    repo: request.params.repo
  }, function(err, result) {
    if (err) {
      response.send(err);
    } else {
      var default_branch = result.default_branch;
      github.repos.getBranch({
        user: request.params.user,
        repo: request.params.repo,
        branch: default_branch
      }, function(err, result) {
        if (err) {
          response.send(err);
        } else {
          var sha = result.commit.sha;
          github.gitdata.getTree({
            user: request.params.user,
            repo: request.params.repo,
            sha: sha,
            recursive: true
          }, function(err, result) {
            if (err) {
              response.send(err);
            } else {
              async.mapSeries(result.tree, function(file, callback) {
                var url = "https://raw.githubusercontent.com/" +
                  request.params.user + "/" + request.params.repo +
                  "/" + sha + "/" + file.path;

                _request(url, function(error, response, body) {
                  if (error) {
                    callback(error);
                  } else {
                    callback(null, {
                      content: body,
                      path: file.path
                    });
                  }
                });
              }, function(err, results) {
                if (err) {
                  response.send(err);
                } else {
                  var items = [];
                  _.each(results, function(file) {
                    var marks = todolist.findMarks(file.content);
                    _.each(marks, function(mark) {
                      mark.file = file.path;
                      mark.context = get_context(file.content, mark.line);
                      items.push(mark);
                    });
                  });

                  render_list(request.params.user, request.params.repo, items, request, response);
                }
              });
            }
          });
        }
      })
    }
  });
});

server.listen(global.PORT, 'localhost', function() {
  console.log("Listening on localhost:" + PORT + "...");
});