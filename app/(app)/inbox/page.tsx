"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "@/components/AppContext";
import { Empty } from "@/components/bits";
import { timeAgo } from "@/lib/format";

export default function InboxPage() {
  const { isLead, geoName } = useApp();
  const items = useQuery(api.notifications.list);
  const markRead = useMutation(api.notifications.markRead);
  const marked = useRef(false);

  // Opening the inbox counts as reading it; unread dots stay visible for this visit.
  useEffect(() => {
    if (items && !marked.current && items.some((n) => !n.readAt)) {
      marked.current = true;
      markRead({}).catch(() => {});
    }
  }, [items, markRead]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="headline">Inbox</h1>
          <p className="muted">Responses to your updates, comments on your reports, and review decisions.</p>
        </div>
      </div>
      {items === undefined && <p className="faint">Loading</p>}
      {items?.length === 0 && <Empty>Nothing yet. When someone responds to one of your updates, it shows up here.</Empty>}
      {items && items.length > 0 && (
        <div className="panel">
          {items.map((n) => {
            const href = n.reportId ? (isLead ? `/reviews?report=${n.reportId}` : "/desk") : n.geography ? `/geo/${n.geography}` : "/";
            return (
              <Link key={n._id} href={href} className="inbox-item">
                <span className={n.readAt ? "" : "unread"} aria-label={n.readAt ? undefined : "Unread"} />
                <span>
                  <span style={{ display: "block", whiteSpace: "pre-wrap" }}>{n.text}</span>
                  <span className="small faint">
                    {n.entryTitle ? `On "${n.entryTitle}"` : n.kind === "report_status" ? "Report review" : "Report comment"}
                    {n.geography ? `, ${geoName(n.geography)}` : ""}
                  </span>
                </span>
                <span className="small faint" style={{ whiteSpace: "nowrap" }}>{timeAgo(n.createdAt)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
