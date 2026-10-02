// Minimal OSC 1.0 codec: int32, float32 and string arguments.
function oscStr(s) {
  const b = Buffer.from(`${s}\0`);
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}

function encode(addr, args = []) {
  let tags = ',';
  const data = args.map((a) => {
    if (typeof a === 'number' && Number.isInteger(a)) {
      tags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a);
      return b;
    }
    if (typeof a === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      return b;
    }
    tags += 's';
    return oscStr(String(a));
  });
  return Buffer.concat([oscStr(addr), oscStr(tags), ...data]);
}

function readStr(buf, off) {
  const end = buf.indexOf(0, off);
  return [buf.toString('utf8', off, end), (end + 4) & ~3];
}

function decode(buf) {
  let [addr, off] = readStr(buf, 0);
  let tags;
  [tags, off] = readStr(buf, off);
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') {
      args.push(buf.readInt32BE(off));
      off += 4;
    } else if (t === 'f') {
      args.push(buf.readFloatBE(off));
      off += 4;
    } else if (t === 's') {
      let s;
      [s, off] = readStr(buf, off);
      args.push(s);
    }
  }
  return { addr, args };
}

module.exports = { encode, decode };
