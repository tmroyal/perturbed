// bridge.js — the Perturbed Bridge (Max for Live), PLAN §0.2. Joins the brain as one more
// surface and keeps track of the outputs. Step 1: connect and log; creating tracks comes next.
//
// Patch: [udpreceive 57150] → [js bridge.js] → [udpsend 127.0.0.1 57120]
// The brain replies to the port named in /hello, since udpsend doesn't send from 57150.

autowatch = 1;
inlets = 1;
outlets = 1;

var LISTEN_PORT = 57150;
var dests = {};        // id → {name, port, channel, instrument}
var bootId = null;     // brain's boot id; a new one means the brain restarted
var answered = true;   // got a /pong since the last /ping

function send() { outlet(0, arrayfromargs(arguments)); }

function hello() {
	dests = {};
	send("/hello", LISTEN_PORT);
}

// Ping every 2 s: re-/hello when the brain restarts, and say when it's gone.
var pinger = new Task(function () {
	if (!answered && bootId !== null) { post("perturbed: brain not answering\n"); bootId = null; }
	answered = false;
	send("/ping", LISTEN_PORT);
}, this);
pinger.interval = 2000;

function loadbang() { pinger.repeat(); }
function bang() { hello(); }   // manual reconnect

function anything() {
	var a = arrayfromargs(arguments);
	switch (messagename) {
	case "/pong":
		answered = true;
		if (a[0] !== bootId) { bootId = a[0]; post("perturbed: brain", bootId, "— connecting\n"); hello(); }
		break;
	case "/dest":
		dests[a[0]] = { name: a[1], port: a[2], channel: a[3], instrument: a[4] };
		post("perturbed: output", a[0], "\"" + a[1] + "\"", "Bus " + a[2], "ch " + a[3], a[4], "\n");
		break;
	case "/dest/removed":
		post("perturbed: output", a[0], "removed\n");
		delete dests[a[0]];
		break;
	case "/state/end":
		post("perturbed: connected,", Object.keys(dests).length, "outputs\n");
		break;
	}
}
