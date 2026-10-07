import { useState } from "react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { field } from "../../../shared/model";
import { Button, PageHeader } from "../../components/ui";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { ContentPanel } from "../content/ContentPanel";
import { DeleteControl } from "../content/DeleteControl";
import { InlineTitle } from "../content/InlineTitle";
import { SortableList } from "../content/SortableList";
import { reorderRecords } from "../content/reorderRecords";
import {
  applicationCompany,
  interviewTime,
} from "../search/applicationRecords";
import { interviewTabs, upcomingInterviews, type InterviewTab } from "./domain";
import { StoryBank } from "./StoryBank";
import "../learn/learn.css";
import "./interviews.css";

export function InterviewsPage() {
  const { editing, continueCreation } = useEditMode();
  const workspace = useWorkspace();
  const { records, create, update, remove, preferences } = workspace;
  const [params, setParams] = useSearchParams();
  const tabs = interviewTabs(records);
  const tab = tabs.find((item) => item.id === params.get("tab")) ?? tabs[0];
  const [newId, setNewId] = useState("");
  const [error, setError] = useState("");
  const saveTab = async (
    item: InterviewTab,
    patch: Record<string, unknown> = {},
    title = item.title,
    expectedVersion?: number,
  ) => {
    const data = {
      ...item.record?.data,
      category: item.record?.data.category ?? "interview-tab",
      ...(item.key ? { tabKey: item.key } : {}),
      order: item.order,
      ...patch,
    };
    return item.record
      ? update(item.record.id, { title, data }, expectedVersion)
      : create({ kind: "note", title, data });
  };
  const upcoming = upcomingInterviews(records);
  return (
    <div
      className={`page interviews-page ${tab?.key === "behavioural" ? "" : "interviews-page-notes"}`}
    >
      <PageHeader
        title="Interviews"
        action={
          editing && (
            <Button
              onClick={async () => {
                try {
                  const next = await create({
                    kind: "note",
                    title: "Untitled",
                    data: { category: "interview-tab", order: tabs.length },
                  });
                  setNewId(next.id);
                  continueCreation();
                  setParams({ tab: next.id });
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Tab could not be created.",
                  );
                }
              }}
            >
              <Plus size={16} />
              Add tab
            </Button>
          )
        }
      />
      <SortableList
        className="section-tabs editable-tabs"
        horizontal
        label="Interview preparation tabs"
        items={tabs}
        onReorder={async (ids) => {
          const ordered = [];
          for (const id of ids) {
            const item = tabs.find((item) => item.id === id)!;
            ordered.push(item.record ?? (await saveTab(item)));
          }
          await reorderRecords(ordered, workspace);
        }}
      >
        {(item, handle) => (
          <div
            className={`editable-tab ${tab?.id === item.id ? "active" : ""}`}
            role="tab"
            id={`interview-tab-${item.id}`}
            aria-controls="interview-tab-content"
            aria-label={item.title}
            aria-selected={tab?.id === item.id}
            tabIndex={tab?.id === item.id ? 0 : -1}
            onClick={() => setParams({ tab: item.id })}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (["Enter", " "].includes(event.key)) {
                event.preventDefault();
                setParams({ tab: item.id });
              } else if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const index = tabs.indexOf(item);
                const next =
                  tabs[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                          tabs.length
                  ];
                setParams({ tab: next.id });
                document.getElementById(`interview-tab-${next.id}`)?.focus();
              }
            }}
          >
            {handle}
            <InlineTitle
              draftKey={`interview-tab-title:${item.id}`}
              version={item.record?.version}
              value={item.title}
              autoFocus={newId === item.id}
              label="Tab name"
              onSave={(title, version) => saveTab(item, {}, title, version)}
            />
          </div>
        )}
      </SortableList>
      {error && <p role="alert">{error}</p>}
      <div className="interview-workspace">
        <div
          role="tabpanel"
          id="interview-tab-content"
          aria-labelledby={tab ? `interview-tab-${tab.id}` : undefined}
        >
          {editing && tab && tab.key !== "behavioural" && (
            <div className="selected-tab-actions interview-tab-actions">
              <DeleteControl
                label="Delete tab"
                actionVariant="danger"
                onDelete={async () => {
                  if (tab.key) await saveTab(tab, { hidden: true });
                  else if (tab.record) await remove(tab.record.id);
                  setParams({});
                }}
              />
            </div>
          )}
          {tab && (
            <>
              {tab.key === "behavioural" && <StoryBank />}
              <section
                className={`interview-intro ${tab.key === "behavioural" ? "interview-intro-behavioural" : ""}`}
              >
                <ContentPanel
                  key={tab.id}
                  record={tab.record}
                  allowBlockReordering={false}
                  context={{
                    scope: "interviews",
                    ...(tab.record?.data.category === "interview-preparation"
                      ? { interviewId: field(tab.record, "interviewId") }
                      : tab.key
                        ? { tabKey: tab.key }
                        : { tabId: tab.id }),
                  }}
                />
              </section>
            </>
          )}
        </div>
        <aside className="interview-upcoming">
          <h2>Upcoming interviews</h2>
          {upcoming.length ? (
            upcoming.map((item) => {
              const application = records.find(
                (record) =>
                  record.kind === "application" &&
                  (record.id === field(item, "applicationId") ||
                    item.links.includes(record.id)),
              );
              return (
                <div key={item.id} className="interview-upcoming-card">
                  <strong>
                    {application
                      ? applicationCompany(application, records)
                      : field(item, "company", "Appointment")}
                  </strong>
                  {application && (
                    <span className="interview-upcoming-role">
                      {application.title}
                    </span>
                  )}
                  <span>{item.title}</span>
                  <span>
                    {interviewTime(
                      item,
                      field(item, "timezone", preferences.timezone),
                    )}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="muted">No upcoming appointments.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
