import { useState, useCallback } from "react";
import { MapPin, Plus, Trash2, Pencil, User, Check, X } from "lucide-react";
import { Button } from "@heroui/react";
import { trpc } from "../trpc";
import type { LocationZone } from "@holms/shared";
import ZoneMapPicker from "./ZoneMapPicker";

interface MapState {
  lat: number;
  lng: number;
  radius: number;
}

function RadiusSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[11px] font-medium flex-shrink-0" style={{ color: "var(--gray-9)" }}>
        Radius
      </label>
      <input
        type="range"
        min={20}
        max={2000}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#3b82f6]"
        style={{ height: 4 }}
      />
      <span
        className="text-[11px] font-mono tabular-nums flex-shrink-0"
        style={{ color: "var(--gray-11)", minWidth: 48, textAlign: "right" }}
      >
        {value}m
      </span>
    </div>
  );
}

function ZoneCard({
  zone,
  isSelected,
  onSelect,
  onDelete,
}: {
  zone: LocationZone;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className="group w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 cursor-pointer"
      style={{
        background: isSelected ? "var(--gray-3)" : "var(--gray-1)",
        border: isSelected ? "1px solid var(--accent-a7)" : "1px solid var(--gray-a5)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex-shrink-0 flex items-center justify-center rounded-md"
          style={{
            width: 28,
            height: 28,
            background: isSelected ? "var(--accent-a3)" : "var(--gray-3)",
            color: isSelected ? "var(--accent-11)" : "var(--gray-9)",
          }}
        >
          <MapPin size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: "var(--gray-12)" }}>
            {zone.name}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--gray-8)" }}>
            {zone.radiusMeters}m radius
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(zone.id); }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          style={{ color: "var(--gray-7)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-7)"; e.currentTarget.style.opacity = ""; }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export default function ZonesPanel() {
  const { data: zones } = trpc.zones.list.useQuery(undefined, { refetchInterval: 5000 });
  const { data: personLocations } = trpc.zones.personLocations.useQuery(undefined, { refetchInterval: 5000 });

  const utils = trpc.useUtils();

  const [mode, setMode] = useState<"idle" | "create" | "edit">("idle");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [nameInput, setNameInput] = useState("");

  const createMutation = trpc.zones.create.useMutation({
    onSuccess: () => {
      utils.zones.list.invalidate();
      utils.zones.personLocations.invalidate();
      resetMode();
    },
  });

  const updateMutation = trpc.zones.update.useMutation({
    onSuccess: () => {
      utils.zones.list.invalidate();
      resetMode();
    },
  });

  const removeMutation = trpc.zones.remove.useMutation({
    onSuccess: () => {
      utils.zones.list.invalidate();
      if (selectedZoneId) setSelectedZoneId(null);
    },
  });

  const resetMode = useCallback(() => {
    setMode("idle");
    setSelectedZoneId(null);
    setMapState(null);
    setNameInput("");
  }, []);

  const startCreate = useCallback(() => {
    setMode("create");
    setSelectedZoneId(null);
    setMapState(null);
    setNameInput("");
  }, []);

  const startEdit = useCallback(
    (zone: LocationZone) => {
      setMode("edit");
      setSelectedZoneId(zone.id);
      setMapState({ lat: zone.latitude, lng: zone.longitude, radius: zone.radiusMeters });
      setNameInput(zone.name);
    },
    [],
  );

  const selectZone = useCallback(
    (zone: LocationZone) => {
      if (mode === "edit" && selectedZoneId === zone.id) return; // already editing
      if (mode === "create") return; // don't interrupt create flow
      startEdit(zone);
    },
    [mode, selectedZoneId, startEdit],
  );

  const handleMapChange = useCallback(
    (lat: number, lng: number, radius: number) => {
      setMapState({ lat, lng, radius });
    },
    [],
  );

  const handleRadiusChange = useCallback(
    (radius: number) => {
      setMapState((prev) => (prev ? { ...prev, radius } : null));
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!mapState || !nameInput.trim()) return;

    if (mode === "create") {
      createMutation.mutate({
        name: nameInput.trim(),
        latitude: mapState.lat,
        longitude: mapState.lng,
        radiusMeters: mapState.radius,
      });
    } else if (mode === "edit" && selectedZoneId) {
      updateMutation.mutate({
        id: selectedZoneId,
        name: nameInput.trim(),
        latitude: mapState.lat,
        longitude: mapState.lng,
        radiusMeters: mapState.radius,
      });
    }
  }, [mode, mapState, nameInput, selectedZoneId, createMutation, updateMutation]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const mapCenter = mapState ? [mapState.lat, mapState.lng] as [number, number] : undefined;

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Zones</h3>
        {mode === "idle" && (
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<Plus size={14} />}
            onPress={startCreate}
          >
            Add zone
          </Button>
        )}
        {mode !== "idle" && (
          <Button size="sm" variant="bordered" onPress={resetMode}>
            Cancel
          </Button>
        )}
      </div>

      {/* Two-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left column — zone list */}
        <div
          className="flex-shrink-0 overflow-auto px-4 py-4 space-y-3"
          style={{ width: 300, borderRight: "1px solid var(--gray-a3)" }}
        >
          {/* Person locations */}
          {personLocations && personLocations.length > 0 && (
            <div>
              <h4
                className="text-[10px] uppercase tracking-wider font-medium mb-2"
                style={{ color: "var(--gray-9)" }}
              >
                Current Locations
              </h4>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {personLocations.map(({ person, location }) => (
                  <div
                    key={person.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px]"
                    style={{
                      background: "var(--gray-1)",
                      border: "1px solid var(--gray-a5)",
                      color: "var(--gray-12)",
                    }}
                  >
                    <User size={10} style={{ color: "var(--gray-8)" }} />
                    <span className="font-medium">{person.name}</span>
                    <span style={{ color: "var(--gray-8)" }}>
                      {location
                        ? `${location.zoneName}`
                        : "Unknown"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Zone list */}
          <div>
            <h4
              className="text-[10px] uppercase tracking-wider font-medium mb-2"
              style={{ color: "var(--gray-9)" }}
            >
              Zones
            </h4>
            {!zones || zones.length === 0 ? (
              <div className="text-[11px] py-4 text-center" style={{ color: "var(--gray-8)" }}>
                No zones yet. Click the map to place one.
              </div>
            ) : (
              <div className="space-y-1.5">
                {zones.map((zone) => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}
                    isSelected={selectedZoneId === zone.id}
                    onSelect={() => selectZone(zone)}
                    onDelete={(id) => removeMutation.mutate({ id })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — map + controls */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-4 pb-0">
            <ZoneMapPicker
              center={mapCenter}
              radius={mapState?.radius ?? 100}
              zones={zones ?? []}
              selectedZoneId={selectedZoneId}
              onChange={handleMapChange}
              onSearchSelect={(name) => {
                if (!nameInput.trim()) setNameInput(name);
              }}
              interactive={mode !== "idle"}
            />
          </div>

          {/* Controls below map */}
          <div className="flex-shrink-0 px-4 py-3 space-y-3">
            {mode === "create" && !mapState && (
              <div className="text-[11px] text-center py-1" style={{ color: "var(--gray-8)" }}>
                Click the map to place a new zone
              </div>
            )}

            {mapState && mode !== "idle" && (
              <>
                <RadiusSlider value={mapState.radius} onChange={handleRadiusChange} />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Zone name..."
                    autoFocus={mode === "edit"}
                    className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors duration-150"
                    style={{
                      background: "var(--gray-1)",
                      border: "1px solid var(--gray-a5)",
                      color: "var(--gray-12)",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-a5)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--gray-a5)"; }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && nameInput.trim()) handleSave();
                      if (e.key === "Escape") resetMode();
                    }}
                  />
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isDisabled={!nameInput.trim()}
                    isLoading={isSaving}
                    onPress={handleSave}
                    startContent={<Check size={14} />}
                  >
                    {mode === "create" ? "Create" : "Save"}
                  </Button>
                </div>
                <div className="text-[10px]" style={{ color: "var(--gray-8)" }}>
                  {mapState.lat.toFixed(5)}, {mapState.lng.toFixed(5)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
