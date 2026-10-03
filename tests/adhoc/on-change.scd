// on-change — test fixture: reports changes to `note` (/test/changed), fails on `boom`
(
params: [[\note, 60, \note], [\boom, 0, \range, 0, 1]],
onChange: (
	note: { |g, p, old, new| ~send.('/test/changed', g[\id], old, new) },
	boom: { |g, p, old, new| nil.noSuchMethod },
),
run: { |g, p| ~grid.(1, { |k| ~strike.(g, p[\note], 80) }) },
)
