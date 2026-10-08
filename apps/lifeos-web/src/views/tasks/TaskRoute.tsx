// T112: /tasks-reitin sisäinen jakaja — ?task=<id> avaa task detail -näkymän,
// muulloin inbox. Syvälinkki on query-parametri (ei polkusegmenttiä), koska
// buildin vite-base on suhteellinen ("./", §44 kannettava buildi) ja
// moniosainen polku rikkoisi asset-polut sivun uudelleenlatauksessa.
// Bonus: nav-korostus jää "Tehtävät"-kohtaan (aktiivinen reitti pysyy
// /tasks) ja paluu säilyttää muut hakuparametrit (esim. tag-suodatin).
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { TaskDetailView } from "./TaskDetailView.tsx";
import { TaskInboxView } from "../today/TaskInboxView.tsx";

export function TaskRoute(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = searchParams.get("task");
  const clearTask = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { preventScrollReset: true });
  }, [searchParams, setSearchParams]);
  if (taskId !== null && taskId !== "") {
    return <TaskDetailView taskId={taskId} onBack={clearTask} />;
  }
  return <TaskInboxView />;
}
