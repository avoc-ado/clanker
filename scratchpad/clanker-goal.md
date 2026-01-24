Clanker workflow

So the purpose of clanker is that a developer can write a doc such as scratchpad/jet-prompt-v1.md.
Then with codex expand its detail slightly.
Then write that to a doc in a new repo root and launch clanker.

Clanker will at a high level run a prompt loop to execute the plan, but how they do this (and specifically their prompts) is critical to avoiding pathological behaviour.

See docs/cursor-scaling-agents.md about roles and pathological behaviour. This is the tool we intent to build.

Planners should take the docs and spit out small, incremental, task packets. They should clarify the assumptions in the docs without a human in the loop by researching both the code, references, and online, writing these research discoveries into docs on origin/main, biasing towards the hard route, completeness, avoiding shortcuts, and software development and testing best practices. planners shouldn't create task packets too large, and large task packets should be pushed back by slaves to be broken up further.

One potential value add of clanker is normally providing such a large task is too complex for an agent to do in one-shot with the fullness and rigor required, while clanker can direct agents to break down large tasks into small workable segments.

A second potential value add of clanker is to eliminate the human from the loop much more than typical. Agents should lean on their own research intuition, rigorous integration testing suites, and mcps to _review_ the _actual running user-facing product_. When agents respond with a message to the user, instead of idling until the user responds (the user would most commonly just say 'continue' to keep the agent working in these situations), the agent would instead be reprompted with a prompt (a reprompt template, or the original prompt template) to keep it moving.

I would like to emphasise that the agents should lean on breaking down tasks into small segments strongly, over tasking a large ask in one-shot sourced from the plan md.

Please lets plan and evaluate clanker, including its prompts and loops, discover these gaps and bridge them, and get this to a point where it is workable.
