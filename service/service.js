/* Wohnzimmer: Dienst für TizenBrew.
   Läuft auf dem Fernseher und lauscht nur auf 127.0.0.1 (nicht im Heimnetz erreichbar).
   Endpunkte (Antwort als JSON, mit ?cb=name als JSONP):
     /ping            Lebenszeichen
     /apps            installierte Apps (id, name)
     /launch/<id>     App starten
*/
var PORT = 18721;
var started = false;

function log(m){ try { console.log("[wohnzimmer] " + m); } catch (e) {} }
function hasTizen(){ return typeof tizen !== "undefined" && tizen && tizen.application; }

/* Notlösung: lokale REST-Schnittstelle des Fernsehers (nutzt die kurze numerische Kennung) */
function restLaunch(id, done){
  try {
    var http = require("http");
    var shortId = String(id).split(".")[0];
    var rq = http.request({ host: "127.0.0.1", port: 8001, path: "/api/v2/applications/" + encodeURIComponent(shortId), method: "POST" }, function(rs){
      rs.resume();
      done(rs.statusCode >= 200 && rs.statusCode < 300, "REST " + rs.statusCode);
    });
    rq.on("error", function(e){ done(false, "REST " + (e && e.message)); });
    rq.end();
  } catch (e) { done(false, "REST " + e); }
}

function launchApp(id, done){
  if (hasTizen()){
    try {
      tizen.application.launch(id, function(){ done(true, "tizen"); }, function(err){
        restLaunch(id, function(ok, how){
          done(ok, ok ? how : "tizen: " + (err && err.message ? err.message : err) + "; " + how);
        });
      });
      return;
    } catch (e) { log("launch: " + e); }
  }
  restLaunch(id, done);
}

function listApps(done){
  if (!hasTizen()){ done(false, []); return; }
  try {
    tizen.application.getAppsInfo(function(list){
      var out = [];
      for (var i = 0; i < list.length; i++){ out.push({ id: list[i].id, name: list[i].name, show: list[i].show }); }
      done(true, out);
    }, function(){ done(false, []); });
  } catch (e) { log("apps: " + e); done(false, []); }
}

function startServer(){
  if (started) return;
  started = true;
  try {
    var http = require("http");
    var server = http.createServer(function(req, res){
      var raw = req.url || "/", q = raw.indexOf("?"), path = q > -1 ? raw.slice(0, q) : raw, cb = null;
      if (q > -1){
        var m = /(?:^|&)cb=([A-Za-z_][A-Za-z0-9_]*)/.exec(raw.slice(q + 1));
        if (m) cb = m[1];
      }
      function send(obj, code){
        var body = JSON.stringify(obj);
        var head = { "Cache-Control": "no-store" };
        if (cb){ body = cb + "(" + body + ");"; head["Content-Type"] = "application/javascript; charset=utf-8"; }
        else { head["Content-Type"] = "application/json; charset=utf-8"; head["Access-Control-Allow-Origin"] = "*"; }
        res.writeHead(code || 200, head);
        res.end(body);
      }
      if (path === "/ping"){ send({ ok: true, tizen: !!hasTizen() }); return; }
      if (path === "/apps"){ listApps(function(ok, apps){ send({ ok: ok, tizen: !!hasTizen(), apps: apps }); }); return; }
      if (path.indexOf("/launch/") === 0){
        var id = decodeURIComponent(path.slice(8));
        if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)){ send({ ok: false, error: "ungültige Kennung" }); return; }
        launchApp(id, function(ok, how){ send({ ok: ok, error: ok ? "" : how, how: how }); });
        return;
      }
      send({ ok: false, error: "unbekannter Pfad" }, 404);
    });
    server.on("error", function(e){ log("server: " + (e && e.message)); started = false; });
    server.listen(PORT, "127.0.0.1", function(){ log("lauscht auf 127.0.0.1:" + PORT); });
  } catch (e) { log("start: " + e); started = false; }
}

/* TizenBrew wertet die Datei je nach Version direkt aus oder ruft onStart auf: beides abgedeckt */
startServer();
if (typeof module !== "undefined" && module){
  module.exports = module.exports || {};
  module.exports.onStart = function(){ startServer(); };
  module.exports.onStop = function(){};
}
