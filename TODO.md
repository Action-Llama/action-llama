# TODO

- Make it easy to add new types of credentials, or define credentials in-place for custom agents.  The harness is not agentic, so it needs structure to know how to prompt for and inject any required credentials.
- Make it easy to add new webhooks.  It's not terribly modular at the moment
- improve webhook trigger filter so they can be completely customized, and minimize triggering the LLM.
- agent containers may want persistent memory; might be fun to allow them to append memory via the gateway.