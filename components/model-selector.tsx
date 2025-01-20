"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import { Command } from "cmdk";

import { saveModelId } from "@/app/(chat)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModels } from "@/lib/ai/models";
import { cn } from "@/lib/utils";

import { CheckCircleFillIcon, ChevronDownIcon, SearchIcon } from "./icons";

type ModelGroup = {
  provider: string;
  models: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

function organizeModels(
  models: Array<{ id: string; label: string; description: string }>
) {
  const grouped: Record<string, ModelGroup> = {};
  const ungrouped: Array<{ id: string; label: string; description: string }> =
    [];

  models.forEach((model) => {
    if (model.id.includes("/")) {
      // For models with provider format (e.g., "openai/gpt-4")
      const [provider] = model.id.split("/");
      if (!grouped[provider]) {
        grouped[provider] = {
          provider,
          models: [],
        };
      }
      grouped[provider].models.push(model);
    } else {
      // For models without provider format
      ungrouped.push(model);
    }
  });

  return { grouped, ungrouped };
}

export function ModelSelector({
  selectedModelId,
  className,
}: {
  selectedModelId: string;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [optimisticModelId, setOptimisticModelId] =
    useOptimistic(selectedModelId);

  const { models, isLoading, error } = useModels();

  // Organize models into grouped and ungrouped
  const { grouped, ungrouped } = useMemo(() => {
    if (!models.length) return { grouped: {}, ungrouped: [] };
    return organizeModels(models);
  }, [models]);

  // Filter models based on search
  const { filteredGrouped, filteredUngrouped } = useMemo(() => {
    if (!search)
      return { filteredGrouped: grouped, filteredUngrouped: ungrouped };

    const searchLower = search.toLowerCase();
    const filteredGrouped: Record<string, ModelGroup> = {};

    // Filter grouped models
    Object.entries(grouped).forEach(([provider, group]) => {
      const matchingModels = group.models.filter(
        (model) =>
          model.label.toLowerCase().includes(searchLower) ||
          model.description.toLowerCase().includes(searchLower)
      );

      if (matchingModels.length > 0) {
        filteredGrouped[provider] = {
          ...group,
          models: matchingModels,
        };
      }
    });

    // Filter ungrouped models
    const filteredUngrouped = ungrouped.filter(
      (model) =>
        model.label.toLowerCase().includes(searchLower) ||
        model.description.toLowerCase().includes(searchLower)
    );

    return { filteredGrouped, filteredUngrouped };
  }, [grouped, ungrouped, search]);

  // Find the selected model for display
  const selectedModel = useMemo(
    () => models.find((model) => model.id === optimisticModelId),
    [models, optimisticModelId]
  );

  // If loading, show a loading state
  if (isLoading) {
    return (
      <Button variant="outline" className="md:px-2 md:h-[34px]" disabled>
        Loading models...
      </Button>
    );
  }

  // If there's an error, show an error state
  if (error) {
    return (
      <Button variant="outline" className="md:px-2 md:h-[34px]" disabled>
        Error loading models
      </Button>
    );
  }

  // If no models are available, show a disabled state
  if (!models.length) {
    return (
      <Button variant="outline" className="md:px-2 md:h-[34px]" disabled>
        No models available
      </Button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          "w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          className
        )}
      >
        <Button variant="outline" className="md:px-2 md:h-[34px]">
          {selectedModel?.label ?? "Select model"}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[300px] p-0">
        <Command className="w-full">
          <div className="flex items-center border-b p-3">
            <SearchIcon className="mr-2 size-4 shrink-0 opacity-50" />
            <input
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-8 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="max-h-[300px] overflow-auto">
            {/* Render grouped models */}
            {Object.entries(filteredGrouped).map(([provider, group]) => (
              <div key={provider} className="p-1">
                <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                  {provider.charAt(0).toUpperCase() + provider.slice(1)}
                </div>
                {group.models.map((model) => (
                  <Command.Item
                    key={model.id}
                    onSelect={() => {
                      setOpen(false);
                      startTransition(() => {
                        setOptimisticModelId(model.id);
                        saveModelId(model.id);
                      });
                    }}
                    className="flex cursor-pointer flex-col gap-1 rounded-sm px-2 py-1.5 text-sm hover:bg-accent data-[selected=true]:bg-accent"
                    data-selected={model.id === optimisticModelId}
                  >
                    <div className="flex justify-between">
                      <span>{model.label}</span>
                      {model.id === optimisticModelId && (
                        <CheckCircleFillIcon className="h-4 w-4" />
                      )}
                    </div>
                    {model.description && (
                      <span className="text-xs text-muted-foreground">
                        {model.description}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </div>
            ))}

            {/* Render ungrouped models */}
            {filteredUngrouped.length > 0 && (
              <div className="p-1">
                {Object.keys(filteredGrouped).length > 0 && (
                  <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                    Other Models
                  </div>
                )}
                {filteredUngrouped.map((model) => (
                  <Command.Item
                    key={model.id}
                    onSelect={() => {
                      setOpen(false);
                      startTransition(() => {
                        setOptimisticModelId(model.id);
                        saveModelId(model.id);
                      });
                    }}
                    className="flex cursor-pointer flex-col gap-1 rounded-sm px-2 py-1.5 text-sm hover:bg-accent data-[selected=true]:bg-accent"
                    data-selected={model.id === optimisticModelId}
                  >
                    <div className="flex justify-between">
                      <span>{model.label}</span>
                      {model.id === optimisticModelId && (
                        <CheckCircleFillIcon className="h-4 w-4" />
                      )}
                    </div>
                    {model.description && (
                      <span className="text-xs text-muted-foreground">
                        {model.description}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </div>
            )}
          </div>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
