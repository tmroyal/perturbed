// config.scd — the rig. Evaluates to an Event.
//
// ports: MIDI outputs, as [device, name]. SuperCollider on macOS can't create virtual ports,
//        so the brain sends to IAC buses (Audio MIDI Setup → IAC Driver). Destination port 1
//        is the first entry, and so on. Live tracks listen to the same buses.
// control: the MIDI output for control changes (LFOs, /cc), as [device, name]: a bus of its own,
//          with Remote on in Live's MIDI settings, so Live's MIDI mapping (⌘M) can learn any
//          parameter. No notes go there. Test mode uses Bus 2 instead, to stay off Live's mappings.
// inputs: MIDI inputs to listen to (keyboard, controllers), as [device, name]; nil = every input
//         except the devices of `ports` and `control` (the brain's own output) and Max's "from Max" ports.
// latency: seconds between logical time and when notes sound; MIDI is timestamped this far ahead.
// destinations: created at boot (not in test mode): [name, port, channel, instrument].
(
ports: [
	["IAC Driver", "Bus 1"],
	["IAC Driver", "Bus 2"],
],
control: ["IAC Driver", "Perturbed CTL 1"],
inputs: nil,
latency: 0.05,
destinations: [
	["Piano 1", 1, 1, "Pianoteq 9"],
	["Piano 2", 1, 2, "Pianoteq 9"],
],
)
