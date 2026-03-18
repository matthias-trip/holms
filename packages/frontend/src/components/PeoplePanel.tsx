import { useState, useCallback, useMemo } from "react";
import { Users, Plus, X, Pencil, Bell, BellOff, Pin } from "lucide-react";
import { Card, CardBody, Button } from "@heroui/react";
import { trpc } from "../trpc";
import type { Person, Memory } from "@holms/shared";
import PanelShell from "./shared/PanelShell";
import EmptyState from "./shared/EmptyState";
import StyledInput from "./shared/StyledInput";
import Dropdown from "./shared/Dropdown";
import ConfirmDeleteButton from "./shared/ConfirmDeleteButton";

/* ── initials helper ───────────────────────────────────────────────── */

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ── person card ───────────────────────────────────────────────────── */

function PersonCard({
  person,
  onDelete,
  index,
  pinnedMemories,
}: {
  person: Person;
  onDelete: (id: string) => void;
  index: number;
  pinnedMemories?: Memory[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [linkChannelId, setLinkChannelId] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);

  const utils = trpc.useUtils();
  const { data: conversations } = trpc.channels.conversations.useQuery();

  const updateMutation = trpc.people.update.useMutation({
    onSuccess: () => {
      utils.people.list.invalidate();
      setEditing(false);
    },
  });

  const linkMutation = trpc.people.linkChannel.useMutation({
    onSuccess: () => {
      utils.people.list.invalidate();
      setLinkChannelId("");
      setShowLinkForm(false);
    },
  });

  const unlinkMutation = trpc.people.unlinkChannel.useMutation({
    onSuccess: () => utils.people.list.invalidate(),
  });

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setName(person.name);
  }, [person.name]);

  const setPrimary = useCallback(
    (channelId: string | null) => {
      updateMutation.mutate({
        id: person.id,
        primaryChannel: channelId,
      });
    },
    [person.id, updateMutation],
  );

  return (
    <Card
      className="animate-fade-in"
      style={{
        animationDelay: `${index * 40}ms`,
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
      }}
    >
      <CardBody>
        <div className="flex gap-3">
          {/* Avatar */}
          <div
            className="flex-shrink-0 flex items-center justify-center rounded-lg text-xs font-bold"
            style={{
              width: 36,
              height: 36,
              background: "var(--accent-a3)",
              border: "1px solid var(--accent-a5)",
              color: "var(--accent-11)",
              marginTop: 2,
            }}
          >
            {getInitials(person.name)}
          </div>

          <div className="flex-1 min-w-0">
            {editing ? (
              /* ── Edit form (name only) ──────────────────────────── */
              <div className="space-y-3">
                <StyledInput label="Name" value={name} onChange={setName} autoFocus />
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isDisabled={!name.trim()}
                    isLoading={updateMutation.isPending}
                    onPress={() =>
                      updateMutation.mutate({
                        id: person.id,
                        name: name.trim(),
                      })
                    }
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="bordered" onPress={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              /* ── Identity block ────────────────────────────────── */
              <span className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
                {person.name}
              </span>
            )}

            {/* ── Channels section (merged primary + linked) ─────── */}
            {!editing && (
              <div
                className="rounded-lg mt-3 p-2.5"
                style={{ background: "var(--gray-a3)" }}
              >
                <span
                  className="text-[10px] uppercase tracking-wider font-medium block mb-1.5"
                  style={{ color: "var(--gray-9)" }}
                >
                  Channels
                </span>

                {person.channels.length > 0 ? (
                  <div className="flex flex-col gap-1 mb-2">
                    {person.channels.map((ch) => {
                      const conv = conversations?.find((c) => c.id === ch.channelId);
                      const isPrimary = person.primaryChannel === ch.channelId;
                      return (
                        <div key={ch.channelId} className="flex items-center gap-2">
                          {/* Primary toggle */}
                          <button
                            onClick={() => setPrimary(isPrimary ? null : ch.channelId)}
                            className="flex-shrink-0 p-0.5 rounded cursor-pointer transition-colors duration-150"
                            style={{
                              color: isPrimary ? "var(--accent-9)" : "var(--gray-7)",
                              background: "transparent",
                              border: "none",
                            }}
                            onMouseEnter={(e) => {
                              if (!isPrimary) e.currentTarget.style.color = "var(--gray-10)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isPrimary) e.currentTarget.style.color = "var(--gray-7)";
                            }}
                            title={isPrimary ? "Primary channel (notifications go here)" : "Set as primary channel"}
                          >
                            {isPrimary ? <Bell size={12} /> : <BellOff size={12} />}
                          </button>
                          <span className="text-xs flex-1 min-w-0" style={{ color: "var(--gray-11)" }}>
                            {conv ? `${conv.providerName}: ${conv.displayName}` : ch.channelId}
                            {isPrimary && (
                              <span className="text-[10px] ml-1.5" style={{ color: "var(--accent-9)" }}>
                                primary
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() => unlinkMutation.mutate({ personId: person.id, channelId: ch.channelId })}
                            className="p-1 rounded cursor-pointer transition-colors duration-150 flex-shrink-0"
                            style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-11)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; }}
                            title="Unlink channel"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : !showLinkForm ? (
                  <span className="text-xs block mb-2" style={{ color: "var(--gray-8)" }}>
                    No channels linked
                  </span>
                ) : null}

                {showLinkForm ? (
                  <div
                    className="space-y-3 pt-2 mt-2"
                    style={{ borderTop: "1px solid var(--gray-a5)" }}
                  >
                    <Dropdown
                      label="Channel"
                      value={linkChannelId}
                      onChange={setLinkChannelId}
                      options={conversations?.map((c) => ({ value: c.id, label: `${c.providerName}: ${c.displayName}` })) ?? []}
                      placeholder="Select channel…"
                    />
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        isDisabled={!linkChannelId}
                        isLoading={linkMutation.isPending}
                        onPress={() =>
                          linkMutation.mutate({
                            personId: person.id,
                            channelId: linkChannelId,
                          })
                        }
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="bordered"
                        onPress={() => {
                          setShowLinkForm(false);
                          setLinkChannelId("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="bordered"
                    startContent={<Plus size={12} />}
                    onPress={() => setShowLinkForm(true)}
                    className="mt-1"
                  >
                    Link channel
                  </Button>
                )}
              </div>
            )}

            {/* ── Pinned memories section ────────────────────────── */}
            {!editing && (
              <div
                className="rounded-lg mt-2 p-2.5"
                style={{ background: "var(--gray-a3)" }}
              >
                <span
                  className="text-[10px] uppercase tracking-wider font-medium flex items-center gap-1 mb-1.5"
                  style={{ color: "var(--gray-9)" }}
                >
                  <Pin size={9} />
                  Pinned Facts
                </span>
                {pinnedMemories && pinnedMemories.length > 0 ? (
                  <div className="space-y-1">
                    {pinnedMemories.map((mem) => (
                      <div key={mem.id} className="text-xs" style={{ color: "var(--gray-12)" }}>
                        {mem.content}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: "var(--gray-8)" }}>
                    No pinned facts yet — the assistant pins important knowledge here
                  </span>
                )}
              </div>
            )}

            {/* ── Footer ─────────────────────────────────────────── */}
            {!editing && (
              <span className="text-xs tabular-nums block mt-2.5" style={{ color: "var(--gray-8)" }}>
                Added {new Date(person.createdAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* ── Top-right actions ─────────────────────────────────── */}
          {!editing && (
            <div className="flex items-start gap-1 flex-shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg cursor-pointer transition-colors duration-150"
                style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-11)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
                title="Edit person"
              >
                <Pencil size={14} />
              </button>
              <ConfirmDeleteButton onConfirm={() => onDelete(person.id)} />
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/* ── create form ───────────────────────────────────────────────────── */

function CreatePersonForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const utils = trpc.useUtils();

  const createMutation = trpc.people.create.useMutation({
    onSuccess: () => {
      utils.people.list.invalidate();
      onCreated();
    },
  });

  return (
    <Card
      style={{
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
      }}
    >
      <CardBody>
        <span
          className="text-xs font-medium block mb-3"
          style={{ color: "var(--gray-12)" }}
        >
          Add person
        </span>
        <div className="space-y-3">
          <StyledInput label="Name" value={name} onChange={setName} autoFocus />
          <div className="flex gap-2 pt-1 justify-end">
            <Button size="sm" variant="bordered" onPress={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              color="primary"
              variant="flat"
              isDisabled={!name.trim()}
              isLoading={createMutation.isPending}
              onPress={() =>
                createMutation.mutate({
                  name: name.trim(),
                })
              }
            >
              Create
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── main panel ────────────────────────────────────────────────────── */

export default function PeoplePanel() {
  const { data: people } = trpc.people.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const { data: pinnedByPerson } = trpc.memory.pinnedByPerson.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const pinnedMap = useMemo(() => {
    const m = new Map<string, Memory[]>();
    if (pinnedByPerson) {
      for (const group of pinnedByPerson) {
        m.set(group.personId, group.memories);
      }
    }
    return m;
  }, [pinnedByPerson]);

  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);

  const removeMutation = trpc.people.remove.useMutation({
    onSuccess: () => utils.people.list.invalidate(),
  });

  return (
    <PanelShell
      title="People"
      headerRight={
        !showCreate ? (
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<Plus size={14} />}
            onPress={() => setShowCreate(true)}
          >
            Add person
          </Button>
        ) : undefined
      }
      contentClassName="px-6 py-6 space-y-2"
    >
      {showCreate && (
        <CreatePersonForm
          onCancel={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}

      {!people || people.length === 0 ? (
        !showCreate && (
          <EmptyState
            icon={<Users size={18} />}
            description="No people yet. Add household members to enable auto-identification and personalized notifications."
          />
        )
      ) : (
        people.map((person, i) => (
          <PersonCard
            key={person.id}
            person={person}
            index={i}
            onDelete={(id) => removeMutation.mutate({ id })}
            pinnedMemories={pinnedMap.get(person.id)}
          />
        ))
      )}
    </PanelShell>
  );
}
