import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PeopleStore } from "./store.js";

export function createPeopleToolsServer(store: PeopleStore) {
  const listPeople = tool(
    "list_people",
    "List all household members with their linked channels.",
    {},
    async () => {
      const people = store.getAll();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(people, null, 2) }],
      };
    },
  );

  const createPerson = tool(
    "create_person",
    "Register a new household member. Use primary_channel to set their preferred notification channel (a conversationId like 'whatsapp:31612345678@s.whatsapp.net').",
    {
      name: z.string().describe("Person's name"),
      primary_channel: z.string().optional().describe("ConversationId for notifications"),
    },
    async (args) => {
      const person = store.create(args.name, args.primary_channel);
      return {
        content: [{ type: "text" as const, text: `Created person "${person.name}" (${person.id})` }],
      };
    },
  );

  const updatePerson = tool(
    "update_person",
    "Update a person's identity fields (name or primary notification channel).",
    {
      person_id: z.string().describe("Person ID"),
      name: z.string().optional().describe("New name"),
      primary_channel: z.string().optional().describe("New primary notification channel"),
    },
    async (args) => {
      const person = store.update(args.person_id, {
        name: args.name,
        primaryChannel: args.primary_channel,
      });
      if (!person) {
        return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      }
      return {
        content: [{ type: "text" as const, text: `Updated person "${person.name}" (${person.id})` }],
      };
    },
  );

  const removePerson = tool(
    "remove_person",
    "Unregister a household member. Cascades to remove their channel links.",
    {
      person_id: z.string().describe("Person ID"),
    },
    async (args) => {
      const removed = store.remove(args.person_id);
      return {
        content: [{
          type: "text" as const,
          text: removed ? `Removed person ${args.person_id}` : `Person ${args.person_id} not found`,
        }],
      };
    },
  );

  const linkPersonChannel = tool(
    "link_person_channel",
    "Associate a channel (conversation) with a person for auto-identification. When a message arrives on this channel or from this sender, the system will identify the person automatically.",
    {
      person_id: z.string().describe("Person ID"),
      channel_id: z.string().describe("ConversationId to link (e.g. 'whatsapp:31612345678@s.whatsapp.net')"),
      sender_id: z.string().optional().describe("Raw senderId from the channel provider (for multi-user channels)"),
    },
    async (args) => {
      const person = store.get(args.person_id);
      if (!person) {
        return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      }
      store.linkChannel(args.person_id, args.channel_id, args.sender_id);
      return {
        content: [{ type: "text" as const, text: `Linked channel ${args.channel_id} to "${person.name}"` }],
      };
    },
  );

  const unlinkPersonChannel = tool(
    "unlink_person_channel",
    "Remove a channel association from a person. The channel will no longer auto-identify this person.",
    {
      person_id: z.string().describe("Person ID"),
      channel_id: z.string().describe("ConversationId to unlink"),
    },
    async (args) => {
      const person = store.get(args.person_id);
      if (!person) {
        return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      }
      store.unlinkChannel(args.person_id, args.channel_id);
      return {
        content: [{ type: "text" as const, text: `Unlinked channel ${args.channel_id} from "${person.name}"` }],
      };
    },
  );

  return createSdkMcpServer({
    name: "people",
    version: "2.0.0",
    tools: [listPeople, createPerson, updatePerson, removePerson, linkPersonChannel, unlinkPersonChannel],
  });
}
