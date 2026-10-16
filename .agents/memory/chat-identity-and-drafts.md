---
name: Chat identities and unsent drafts
description: Store-owner naming and when an opened conversation belongs in an inbox.
---

Opening “Chat with seller” without sending a message must not add an empty chat to either inbox. Text and media-only messages both establish a real conversation. Preserve existing messages rather than deleting conversations to hide drafts.

**Why:** The user reported that merely clicking the chat button put the visitor in the seller's chat box and asked to stop that.

**How to apply:** Keep opening the composer possible, including on stores without products, but distinguish unsent drafts from inbox entries.

Store owners must appear to their chat partners by store name, including when they contact another store as a customer. Do not change their conversation role, permissions, notification recipient, or subscription activity classification merely because they own a store.

**Why:** The user said that when someone owns a store, the name shown to the other person when texting should be the store name, not the email.

**How to apply:** Resolve ownership on the server for message labels, chat lists/headers, and notification titles. Existing email-labelled conversations should also display the owned store name on read.

For multiple-store accounts contacting another seller, use the earliest-created store consistently. Replies on an owned store's conversation identify that particular store instead.

**Why:** There is no selected sending-store context when a customer contacts another seller; a deterministic choice avoids arbitrary name changes without adding an unrequested store picker. Replies already have an explicit store context.

**How to apply:** Keep presentation identity separate from participant role and never trust a client-submitted store name.
