// triad — test fixture: an AdHoc type that provides a chord (a `chord` function): a major triad on `root`
(
params: [[\root, 48, \range, 0, 115]],
output: false,
on: true,
onChange: (root: { |g| ~syncChord.() }),
chord: { |g, p| p[\root].asInteger + [0, 4, 7] },
)
