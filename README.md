# n8n-nodes-katiespeaker

This is an [n8n](https://n8n.io/) community node that integrates with [Katie Speaker](https://katiespeaker.com) — a smart speaker platform for delivering spoken notifications hands-free.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

- **Publish Message** — Send a text message to your Katie Speaker channel. The device converts it to natural speech and plays it aloud.
- **Broadcast Message** — Send a message to all subscribers, bypassing their individual filters.
- **Get Subscriber Filters** — Retrieve the aggregated filter rules set by your channel's subscribers.
- **Should Publish** — Check whether any subscriber would receive a message with given metadata before sending it (saves API costs).

## Credentials

To use this node, you need a Katie Speaker account and a channel API key:

1. Create an account at [app.katiespeaker.com](https://app.katiespeaker.com/register)
2. Create a channel in your dashboard
3. Copy the API key from your channel settings
4. In n8n, add new **Katie Speaker API** credentials and paste your key

## Resources

- [Katie Speaker Developer Portal](https://katiespeaker.com/developers)
- [API Reference](https://katiespeaker.com/developers/api)
- [Quick Start Guide](https://katiespeaker.com/developers/quickstart)
- [Python SDK](https://github.com/hobbyquant/KatiePublisherSDK_Py)
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
