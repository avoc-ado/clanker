We need to create a clone of Jet Protocol V1 Lending and Borrowing
please replicate all high level architecture decisions
such as a local test validator with smart contract
a nextjs frontend which communicates with RPC directly
there should be a full unit test and integration test suite which should run after every change
there should be 85% unit test coverage
there should be a rich typescript cli for all functionality with integration testing
frontend should heavily code-share with cli
there should be e2e web integration tests with playwright
assume multiple agents are running integration tests on the same machine
so ports should be a parallel test strategy such as isolated or random ports to not interfere with each other
use https://github.com/GHesericsu/jet-v1/ as a reference

- clone this in a subdir
- do research about it and its capabilities via code or online research and write this down into repo documents for later reference
  there should be a rich web UI
  you should use chrome-devtools to verify the look and feel of the UI after every change relevant.
