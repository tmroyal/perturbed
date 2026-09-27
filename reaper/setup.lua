-- setup.lua — builds REAPER tracks from destinations.json (written by the brain).
--
-- One track per destination, matched by name: MIDI input = the destination's port (an IAC bus)
-- and channel, record-armed in "none (monitor only)" mode with monitoring on, so the track plays
-- incoming MIDI without recording it. An instrument is added only to tracks that have none, so
-- instrument choices and presets made in REAPER are kept. Tracks not in the file are left alone.
--
-- Run from Actions → Show action list → New action → Load ReaScript..., then re-run it any time
-- the brain's destinations change.

local dir = ({ reaper.get_action_context() })[2]:match("^(.*)[/\\]")

-- Minimal JSON reader: objects, arrays, strings, numbers, true/false/null.
local function decodeJSON(s)
  local i = 1
  local value
  local function ws() i = s:find("%S", i) or #s + 1 end
  local function str()
    local out, j = {}, i + 1
    while true do
      local c = s:sub(j, j)
      if c == '"' then i = j + 1; return table.concat(out) end
      if c == "\\" then j = j + 1; c = s:sub(j, j); c = ({ n = "\n", t = "\t" })[c] or c end
      if c == "" then error("unterminated string") end
      out[#out + 1] = c
      j = j + 1
    end
  end
  function value()
    ws()
    local c = s:sub(i, i)
    if c == "{" then
      local t = {}
      i = i + 1; ws()
      if s:sub(i, i) == "}" then i = i + 1; return t end
      repeat
        ws(); local k = str(); ws(); i = i + 1 -- ':'
        t[k] = value(); ws()
        c = s:sub(i, i); i = i + 1
      until c == "}"
      return t
    elseif c == "[" then
      local t = {}
      i = i + 1; ws()
      if s:sub(i, i) == "]" then i = i + 1; return t end
      repeat
        t[#t + 1] = value(); ws()
        c = s:sub(i, i); i = i + 1
      until c == "]"
      return t
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4; return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5; return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4; return nil
    else
      local num = s:match("^-?[%d.eE+-]+", i)
      i = i + #num
      return tonumber(num)
    end
  end
  return value()
end

local function readFile(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local s = f:read("a")
  f:close()
  return s
end

-- REAPER addresses MIDI inputs by index; find the port by name ("IAC Driver Bus 1", or just "Bus 1").
local function midiInputIndex(portName)
  local short = portName:gsub("^IAC Driver ", "")
  for i = 0, reaper.GetNumMIDIInputs() - 1 do
    local ok, name = reaper.GetMIDIInputName(i, "")
    if ok and (name == portName or name == short) then return i end
  end
end

local function findTrack(name)
  for i = 0, reaper.CountTracks(0) - 1 do
    local tr = reaper.GetTrack(0, i)
    local _, trName = reaper.GetSetMediaTrackInfo_String(tr, "P_NAME", "", false)
    if trName == name then return tr end
  end
end

local text = readFile(dir .. "/destinations.json")
if not text then
  reaper.MB("No destinations.json next to setup.lua. Start the brain once to write it.", "performed", 0)
  return
end
local cfg = decodeJSON(text)

local problems = {}
reaper.Undo_BeginBlock()
reaper.PreventUIRefresh(1)

for _, d in ipairs(cfg.destinations) do
  local tr = findTrack(d.name)
  if not tr then
    reaper.InsertTrackAtIndex(reaper.CountTracks(0), true)
    tr = reaper.GetTrack(0, reaper.CountTracks(0) - 1)
    reaper.GetSetMediaTrackInfo_String(tr, "P_NAME", d.name, true)
  end

  local portName = cfg.ports[d.port]
  local dev = portName and midiInputIndex(portName)
  if dev then
    -- MIDI input: 4096 flag | device index << 5 | channel (1-16, 0 = all)
    reaper.SetMediaTrackInfo_Value(tr, "I_RECINPUT", 4096 + (dev << 5) + d.channel)
    reaper.SetMediaTrackInfo_Value(tr, "I_RECMODE", 2) -- none: monitor only
    reaper.SetMediaTrackInfo_Value(tr, "I_RECMON", 1)
    reaper.SetMediaTrackInfo_Value(tr, "I_RECARM", 1)
  else
    -- Never arm with REAPER's default input (audio in 1): monitoring it feeds back.
    reaper.SetMediaTrackInfo_Value(tr, "I_RECARM", 0)
    reaper.SetMediaTrackInfo_Value(tr, "I_RECMON", 0)
    reaper.SetMediaTrackInfo_Value(tr, "I_RECINPUT", -1)
    problems[#problems + 1] = ("%s: MIDI input '%s' not found; track left unarmed"):format(d.name, tostring(portName))
  end

  if d.instrument ~= "" and d.instrument ~= "none" and reaper.TrackFX_GetInstrument(tr) < 0 then
    if reaper.TrackFX_AddByName(tr, d.instrument, false, -1) < 0 then
      problems[#problems + 1] = ("%s: instrument '%s' not found"):format(d.name, d.instrument)
    end
  end
end

reaper.PreventUIRefresh(-1)
reaper.TrackList_AdjustWindows(false)
reaper.Undo_EndBlock("performed: set up destination tracks", -1)

if #problems > 0 then
  local inputs = {}
  for i = 0, reaper.GetNumMIDIInputs() - 1 do
    local ok, name = reaper.GetMIDIInputName(i, "")
    if ok then inputs[#inputs + 1] = ("  %d: %s"):format(i, name) end
  end
  reaper.MB(table.concat(problems, "\n") .. "\n\nMIDI inputs REAPER reports (enable in Preferences → MIDI Inputs; "
    .. "new devices need a restart):\n" .. (#inputs > 0 and table.concat(inputs, "\n") or "  (none)"),
    "performed setup", 0)
end
