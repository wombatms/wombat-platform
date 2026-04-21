import { LogOut, User as UserIcon, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  const initials = user?.display_name
    ? user.display_name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0]?.toUpperCase() ?? "")
        .join("")
    : user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`User menu for ${user?.display_name ?? user?.email ?? "account"}`}
          className="rounded-full"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent-fg)",
              border: "1px solid var(--border-default)",
            }}
          >
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {user && (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                {user.display_name && (
                  <span className="text-sm font-medium">{user.display_name}</span>
                )}
                <span
                  className="truncate text-xs"
                  style={{ color: "var(--fg-muted)" }}
                >
                  {user.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => navigate("/settings/profile")}>
          <UserIcon className="mr-2 h-4 w-4" aria-hidden="true" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings/theme")}>
          <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={logout}
          className="text-[color:var(--feedback-error-fg)] focus:text-[color:var(--feedback-error-fg)]"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
