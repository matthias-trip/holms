import { useState, useMemo } from "react";
import { Button, Chip } from "@heroui/react";
import { ArrowLeft, Search, Check } from "lucide-react";
import { trpc } from "../trpc";

interface Props {
  onBack: () => void;
}

export default function HAEntityPicker({ onBack }: Props) {
  const { data: allEntities } = trpc.deviceProviders.haAllEntities.useQuery();
  const { data: selectedIds } = trpc.deviceProviders.haSelectedEntities.useQuery();

  const utils = trpc.useUtils();
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveMutation = trpc.deviceProviders.haSetSelectedEntities.useMutation({
    onSuccess: () => {
      utils.deviceProviders.haSelectedEntities.invalidate();
      utils.deviceProviders.list.invalidate();
      setSaving(false);
      onBack();
    },
    onError: () => setSaving(false),
  });

  // Initialize selection from server data
  const selected = useMemo(() => {
    if (selection !== null) return selection;
    return new Set(selectedIds ?? []);
  }, [selection, selectedIds]);

  // Group entities by domain
  const domains = useMemo(() => {
    if (!allEntities) return [];
    const domainSet = new Set(allEntities.map((e) => e.domain));
    return Array.from(domainSet).sort();
  }, [allEntities]);

  // Filter entities
  const filtered = useMemo(() => {
    if (!allEntities) return [];
    return allEntities.filter((e) => {
      if (domainFilter && e.domain !== domainFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.entity_id.toLowerCase().includes(q) ||
          e.friendly_name.toLowerCase().includes(q) ||
          (e.area_name?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [allEntities, domainFilter, search]);

  const toggleEntity = (entityId: string) => {
    setSelection((prev) => {
      const s = new Set(prev ?? selected);
      if (s.has(entityId)) s.delete(entityId);
      else s.add(entityId);
      return s;
    });
  };

  const toggleDomain = (domain: string, selectAll: boolean) => {
    setSelection((prev) => {
      const s = new Set(prev ?? selected);
      const domainEntities = (allEntities ?? []).filter((e) => e.domain === domain);
      for (const e of domainEntities) {
        if (selectAll) s.add(e.entity_id);
        else s.delete(e.entity_id);
      }
      return s;
    });
  };

  const handleSave = () => {
    setSaving(true);
    saveMutation.mutate({ entityIds: Array.from(selected) });
  };

  const domainEntityCount = (domain: string) =>
    (allEntities ?? []).filter((e) => e.domain === domain).length;

  const domainSelectedCount = (domain: string) =>
    (allEntities ?? []).filter((e) => e.domain === domain && selected.has(e.entity_id)).length;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="light" size="sm" isIconOnly onPress={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>
            Home Assistant Entities
          </h3>
          <p className="text-xs" style={{ color: "var(--gray-9)" }}>
            Select which entities to expose to the assistant ({selected.size} selected)
          </p>
        </div>
        <div className="ml-auto">
          <Button
            color="primary"
            variant="flat"
            size="sm"
            onPress={handleSave}
            isDisabled={saving}
          >
            {saving ? "Saving..." : "Save Selection"}
          </Button>
        </div>
      </div>

      {/* Search + domain filter */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--gray-8)" }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities..."
            className="w-full text-xs pl-8 pr-3 py-2 rounded-lg outline-none"
            style={{
              background: "var(--gray-3)",
              border: "1px solid var(--gray-a5)",
              color: "var(--gray-12)",
            }}
          />
        </div>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap">
        <button
          onClick={() => setDomainFilter(null)}
          className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-150"
          style={{
            background: domainFilter === null ? "var(--gray-3)" : "transparent",
            border: domainFilter === null ? "1px solid var(--gray-a5)" : "1px solid transparent",
            color: domainFilter === null ? "var(--gray-12)" : "var(--gray-9)",
          }}
        >
          All ({allEntities?.length ?? 0})
        </button>
        {domains.map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(domainFilter === d ? null : d)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-150"
            style={{
              background: domainFilter === d ? "var(--gray-3)" : "transparent",
              border: domainFilter === d ? "1px solid var(--gray-a5)" : "1px solid transparent",
              color: domainFilter === d ? "var(--gray-12)" : "var(--gray-9)",
            }}
          >
            {d} ({domainEntityCount(d)})
          </button>
        ))}
      </div>

      {/* Domain select all/none buttons */}
      {domainFilter && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => toggleDomain(domainFilter, true)}
            className="text-xs px-2 py-1 rounded"
            style={{ color: "var(--accent-9)" }}
          >
            Select all {domainFilter}
          </button>
          <button
            onClick={() => toggleDomain(domainFilter, false)}
            className="text-xs px-2 py-1 rounded"
            style={{ color: "var(--gray-9)" }}
          >
            Deselect all
          </button>
          <span className="text-xs ml-auto" style={{ color: "var(--gray-8)" }}>
            {domainSelectedCount(domainFilter)} / {domainEntityCount(domainFilter)} selected
          </span>
        </div>
      )}

      {/* Entity list */}
      <div className="flex-1 overflow-auto space-y-0.5">
        {filtered.map((entity) => {
          const isSelected = selected.has(entity.entity_id);
          return (
            <button
              key={entity.entity_id}
              onClick={() => toggleEntity(entity.entity_id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-100"
              style={{
                background: isSelected ? "var(--accent-a3)" : "transparent",
                border: isSelected ? "1px solid var(--accent-a5)" : "1px solid transparent",
              }}
            >
              <div
                className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                style={{
                  borderColor: isSelected ? "var(--accent-9)" : "var(--gray-7)",
                  background: isSelected ? "var(--accent-9)" : "transparent",
                }}
              >
                {isSelected && <Check size={10} color="white" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: "var(--gray-12)" }}>
                    {entity.friendly_name}
                  </span>
                  <Chip variant="flat" size="sm">
                    {entity.domain}
                  </Chip>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs truncate" style={{ color: "var(--gray-8)", fontFamily: "var(--font-mono)" }}>
                    {entity.entity_id}
                  </span>
                  {entity.area_name && (
                    <span className="text-xs" style={{ color: "var(--gray-7)" }}>
                      {entity.area_name}
                    </span>
                  )}
                </div>
              </div>

              <span className="text-xs flex-shrink-0" style={{ color: "var(--gray-9)" }}>
                {entity.state}
              </span>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: "var(--gray-8)" }}>
              {allEntities?.length === 0
                ? "No entities found. Is Home Assistant connected?"
                : "No entities match your search."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
