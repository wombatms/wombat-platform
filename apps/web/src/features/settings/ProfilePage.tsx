import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";

interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

function ProfileSkeleton() {
  return (
    <div className="p-6 max-w-lg" aria-busy="true" aria-label="Loading profile">
      <div className="rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center px-5 py-4 border-b last:border-0"
            style={{ borderColor: "var(--border-default)" }}>
            <div className="h-3 w-28 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
            <div className="ml-8 h-3 w-40 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-start gap-6 px-5 py-4 border-b last:border-0"
      style={{ borderColor: "var(--border-default)" }}
    >
      <dt
        className="w-32 shrink-0 text-[12px] font-semibold pt-0.5"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </dt>
      <dd
        className="flex-1 min-w-0 text-[13px] break-all"
        style={{ color: "var(--fg-default)" }}
      >
        {value}
      </dd>
    </div>
  );
}

export function ProfilePage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.auth.me,
    queryFn: async (): Promise<UserProfile> => {
      const { data, error } = await api.GET("/api/auth/me");
      if (error) throw error;
      return data as UserProfile;
    },
  });

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Profile" subtitle="Your account information" />
      <div className="p-6 max-w-lg">
        {isLoading ? (
          <ProfileSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data ? (
          <div
            className="rounded-lg border overflow-hidden"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-surface-1)",
            }}
          >
            <dl>
              <FieldRow label="Display name" value={data.display_name} />
              <FieldRow label="Email" value={data.email} />
              <FieldRow label="Member since" value={new Date(data.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} />
              <FieldRow label="Account ID" value={data.id} />
              <FieldRow label="Status" value={data.is_active ? "Active" : "Inactive"} />
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
