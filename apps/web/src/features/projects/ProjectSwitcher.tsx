import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useProjects } from "./useProjects";
import { useActiveProject } from "./useActiveProject";

export function ProjectSwitcher() {
  const { data: projects } = useProjects();
  const { projectSlug } = useActiveProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const current = projects?.find((p) => p.slug === projectSlug);

  const handleSelect = (slug: string) => {
    setOpen(false);
    navigate(`/p/${slug}/library`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch project"
          className="h-8 max-w-[180px] justify-between truncate text-sm font-medium"
          style={{ color: "var(--fg-default)" }}
        >
          <span className="truncate">{current?.name ?? "Select project"}</span>
          <svg
            className="ml-1 h-4 w-4 shrink-0 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-default)",
        }}
      >
        <Command>
          <CommandInput placeholder="Filter projects…" />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              {(projects ?? []).map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.slug}
                  onSelect={() => handleSelect(project.slug)}
                  className="cursor-pointer"
                >
                  <span className="truncate">{project.name}</span>
                  {project.slug === projectSlug && (
                    <svg
                      className="ml-auto h-4 w-4 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
