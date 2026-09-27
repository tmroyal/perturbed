// config.scd — the rig. Evaluates to an Event.
//
// ports: MIDI outputs, as [device, name]. SuperCollider on macOS can't create virtual ports,
//        so the brain sends to IAC buses (Audio MIDI Setup → IAC Driver). Destination port 1
//        is the first entry, and so on. REAPER tracks listen to the same buses.
// latency: seconds between logical time and when notes sound; MIDI is timestamped this far ahead.
// destinations: created at boot (not in test mode): [name, port, channel, instrument].
(
ports: [
	["IAC Driver", "Bus 1"],
	["IAC Driver", "Bus 2"],
],
latency: 0.05,
destinations: [
	["Piano 1", 1, 1, "Pianoteq 9"],
	["Piano 2", 1, 2, "Pianoteq 9"],
],
)
