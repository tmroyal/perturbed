// bridge.js — the Perturbed Bridge (Max for Live), PLAN §0.2. Joins the brain as one more
// surface and reports Live's tracks that listen to the brain's IAC buses, so the app can make
// outputs from them.
//
// Patch: [live.thisdevice] → [js bridge.js] ← [udpreceive 57150];  [js bridge.js] → [udpsend 127.0.0.1 57120]
// The brain replies to the port named in /hello, since udpsend doesn't send from 57150.
// The Live API is usable only once live.thisdevice has banged, so everything starts from bang().
//
// To the brain:  /live/tracks <name> <port> <channel> <instrument> ...   (4 args per track; port is
//                the brain's port number, channel 0 = "All Channels"), sent on connect and on change
//                /live/tracks/clear    when the device is removed

autowatch = 1;
inlets = 1;
outlets = 1;

var LISTEN_PORT = 57150;
var ports = [];        // the brain's MIDI ports, squashed ("iacdriverbus1"); port n = ports[n-1]
var bootId = null;     // brain's boot id; a new one means the brain restarted
var answered = true;   // got a /pong since the last /ping
var ready = false;     // the Live API is usable
var trackIds = "";     // ids of the tracks being observed, to notice added/removed tracks
var observers = [];
var sent = null;       // the last /live/tracks args sent, to send only changes
var unmatched = {};    // IAC inputs already reported as matching no port

var DEBUG = 0;         // trace Live API steps to the Max Console
function trace() { if (DEBUG) post("perturbed ·", arrayfromargs(arguments).join(" "), "\n"); }

function send() { outlet(0, arrayfromargs(arguments)); }
function squash(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

// --- connection: ping every 2 s, re-/hello when the brain restarts ---
var pinger = new Task(function () {
	if (!answered && bootId !== null) { post("perturbed: brain not answering\n"); bootId = null; }
	answered = false;
	send("/ping", LISTEN_PORT);
}, this);
pinger.interval = 2000;

function bang() {   // from live.thisdevice
	if (ready) return;
	ready = true;
	trace("Live API ready");
	pinger.repeat();
	rescan();
}

// After an edit (autowatch reload) live.thisdevice won't bang again: start if the API already works.
var boot = new Task(function () { if (new LiveAPI("live_set").id != 0) bang(); }, this);
boot.schedule(500);

function notifydeleted() { send("/live/tracks/clear"); }

function anything() {
	var a = arrayfromargs(arguments);
	switch (messagename) {
	case "/pong":
		answered = true;
		if (a[0] !== bootId) { bootId = a[0]; post("perturbed: brain", bootId, "— connecting\n"); send("/hello", LISTEN_PORT); }
		break;
	case "/ports":
		ports = a.map(squash);
		break;
	case "/state/end":
		post("perturbed: connected\n");
		sent = null;   // (re)connected: send the tracks again
		rescan();
		break;
	}
}

// --- Live's tracks ---

// A dictionary property ({display_name, identifier}); the Live API returns it as JSON text.
function dictProp(api, prop) {
	var v = api.get(prop);
	try {
		var o = JSON.parse(v instanceof Array ? v.join(" ") : String(v));
		return o[prop] || o;
	} catch (e) {
		post("perturbed: can't read", prop, v, "\n");
		return null;
	}
}

function text(api, prop) { var v = api.get(prop); return v instanceof Array ? v.join(" ") : String(v); }

// Tracks change a lot at once (a rename fires per keystroke): rescan shortly after the last change.
var debounce = new Task(rescan, this);
function changed() { if (ready) debounce.schedule(200); }

function rescan() {
	if (!ready) return;
	var song = new LiveAPI("live_set");
	var n = song.getcount("tracks");
	trace("rescan:", n, "tracks");
	var ids = [], report = [];
	for (var i = 0; i < n; i++) {
		var t = new LiveAPI("live_set tracks " + i);
		ids.push(t.id);
		trace("track", i, "id", t.id, "midi in", t.get("has_midi_input"), "input", t.get("input_routing_type"));
		if (t.get("has_midi_input")[0] != 1) continue;
		var type = dictProp(t, "input_routing_type");
		var port = type ? ports.indexOf(squash(type.display_name)) + 1 : 0;
		if (port < 1) {   // not listening to one of the brain's buses
			if (type && /iac/i.test(type.display_name) && !(type.display_name in unmatched)) {
				unmatched[type.display_name] = true;
				post("perturbed: input \"" + type.display_name + "\" matches none of the brain's ports", ports, "\n");
			}
			continue;
		}
		var ch = dictProp(t, "input_routing_channel");
		var m = ch && /(\d+)/.exec(ch.display_name);
		var dev = t.getcount("devices") > 0 ? text(new LiveAPI("live_set tracks " + i + " devices 0"), "name") : "";
		report.push(text(t, "name"), port, m ? parseInt(m[1]) : 0, dev);
	}
	if (ids.join() !== trackIds) observe(ids);
	var key = JSON.stringify(report);
	if (key !== sent && bootId !== null) {
		sent = key;
		send.apply(this, ["/live/tracks"].concat(report));
		post("perturbed:", report.length / 4, "Live tracks on the brain's buses\n");
	}
}

// Watch the track list, and each track's name, input and instrument.
function observe(ids) {
	trackIds = ids.join();
	trace("clearing", observers.length, "observers");
	observers.forEach(function (o) { o.property = ""; });
	observers = [];
	var watch = function (path, prop) {
		trace("observe", path, prop);
		var o = new LiveAPI(changed, path);
		o.property = prop;
		observers.push(o);
	};
	watch("live_set", "tracks");
	ids.forEach(function (id) {
		["name", "input_routing_type", "input_routing_channel", "devices"].forEach(function (p) { watch("id " + id, p); });
	});
}
