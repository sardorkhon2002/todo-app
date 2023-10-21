import React, { useEffect, useMemo, useRef, useState, useContext } from "react";
import "./App.css";
import { nanoid } from "nanoid";
import * as R from "ramda";
import cx from "classnames";
import { io, Socket } from "socket.io-client";
import { makeAutoObservable, reaction, runInAction, toJS } from "mobx";
import { observer } from "mobx-react";
import axios from "axios";
import { useEventListener } from "ahooks";
import * as process from "process";


const StoreContext = React.createContext<TasksStore | null>(null);

interface Task {
  id: string;
  title: string;
  status: string;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

type Delta = {
  before: Task | null;
  after: Task | null;
};

export class TasksStore {
  socket: Socket;
  tasks: Record<string, Task> = {};
  baseUrl: string = process.env.API_URL || "http://localhost:3001";
  ignoreChanges: boolean = false;
  deltaStack: Delta[] = [];
  deltaPointer: number = -1;
  ignoreDelta: boolean = false;
  promises: Promise<any>[] = [];

  constructor() {
    makeAutoObservable(this);
    this.socket = io(this.baseUrl);
    reaction(
      () => {
        console.log("this.tasks", this.tasks);
        return toJS(this.tasks);
      },
      async (newTasks, oldTasks) => {
        console.log("newTasks11", newTasks);
        console.log("oldTasks11", oldTasks);
        if (this.ignoreChanges) {
          this.ignoreChanges = false;
          return;
        }
        console.log("newTasks", newTasks);
        console.log("oldTasks", oldTasks);
        console.log(newTasks);
        console.log(oldTasks);
        const tasksToCreate = R.difference(
          Object.keys(newTasks),
          Object.keys(oldTasks)
        );
        console.log(tasksToCreate, "tasks");
        const tasksToDelete = R.difference(
          Object.keys(oldTasks),
          Object.keys(newTasks)
        );
        const tasksToUpdate = R.filter(
          (taskKey: string) => !R.equals(newTasks[taskKey], oldTasks[taskKey]),
          R.intersection(Object.keys(newTasks), Object.keys(oldTasks))
        );
        console.log(tasksToUpdate, "tasksToUpdate");

        await Promise.all(this.promises);

        for (const id of tasksToDelete) {
          this.promises.push(this.deleteTask(id));
          if (!this.ignoreDelta) {
            this.deltaStack.push({
              before: toJS(oldTasks[id]),
              after: null,
            });
            this.deltaPointer++;
            this.deltaStack.splice(this.deltaPointer + 1);
          }
        }
        for (const id of tasksToCreate) {
          this.promises.push(this.createTask(newTasks[id]));
          if (!this.ignoreDelta) {
            this.deltaStack.push({
              before: null,
              after: toJS(newTasks[id]),
            });
            this.deltaPointer++;
            this.deltaStack.splice(this.deltaPointer + 1);
          }
        }
        for (const id of tasksToUpdate) {
          this.promises.push(this.createTask(newTasks[id]));
          if (!this.ignoreDelta) {
            this.deltaStack.push({
              before: toJS(oldTasks[id]),
              after: toJS(newTasks[id]),
            });
            this.deltaPointer++;
            this.deltaStack.splice(this.deltaPointer + 1);
          }
        }
        if (this.ignoreDelta) {
          this.ignoreDelta = false;
        }
        console.log("delta", toJS(this.deltaStack));
      }
    );
    this.socket.on("connect", async () => {
      this.socket.on("tasks", (data) => {
        runInAction(() => {
          console.log("data", data);
          this.tasks = R.mergeWith(
            R.mergeRight,
            this.tasks,
            R.indexBy(R.prop("id"), data)
          );
          this.ignoreChanges = true;
        });
      });
      this.socket.emit("tasks:subscribe");
    });
  }

  get tasksArray() {
    return Object.values(this.tasks).filter((task) => !task.deletedAt);
  }

  // statusOrder rewrite to TypeScript
  statusOrder: Record<string, number> = {
    "not-started": 0,
    planned: 1,
    "in-progress": 2,
    testing: 3,
    done: 4,
  };

  get tasksByStatus() {
    const sortedByStatusOrder = R.sortWith(
      [
        R.ascend(
          R.compose(
            (status: string) => this.statusOrder[status],
            R.prop("status")
          )
        ),
        R.ascend((task: Task) => {
          return task.updatedAt ? new Date(task.updatedAt).getTime() : 0;
        }),
      ]
      //   get number by statusOrder
    )(this.tasksArray);

    return R.groupBy(R.prop("status"), sortedByStatusOrder);
  }

  undo(): void {
    if (this.deltaPointer < 0) {
      return;
    }
    const delta = this.deltaStack[this.deltaPointer];
    const block: any = document.querySelector(
      `[data-column-id="${delta.after?.id}"]`
    );
    if (block?.getBoundingClientRect().y > window.screen.height) {
      block.scrollIntoView({ behavior: "smooth" });
      block.classList.add("highlight");
      setTimeout(function () {
        block.classList.remove("highlight");
      }, 1000);
      return;
    }
    this.deltaPointer--;
    this.ignoreDelta = true;
    if (delta.before) {
      this.tasks[delta.before.id] = delta.before;
    } else {
      delete this.tasks[delta.after!.id];
    }
  }

  redo(): void {
    if (this.deltaPointer >= this.deltaStack.length - 1) {
      return;
    }
    const block: any = document.querySelector(
      `[data-column-id="${this.deltaStack[this.deltaPointer + 1].before?.id}"]`
    );
    if (block?.getBoundingClientRect().y > window.screen.height) {
      block.scrollIntoView({ behavior: "smooth" });
      block.classList.add("highlight");
      setTimeout(function () {
        block.classList.remove("highlight");
      }, 1000);
      return;
    }
    this.deltaPointer++;
    const delta = this.deltaStack[this.deltaPointer];
    this.ignoreDelta = true;
    if (delta.after) {
      this.tasks[delta.after.id] = delta.after;
    } else {
      delete this.tasks[delta.before!.id];
    }
  }

  async deleteTask(id: string) {
    await axios.request({
      url: `${this.baseUrl}/tasks/${id}`,
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        // Add any additional headers required by your API
      },
    });
  }

  async createTask(newTask: Task) {
    await axios.request({
      url: `${this.baseUrl}/tasks`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      data: newTask,
    });
  }
}

function TaskItem({
  task,
  setDraggingTask,
  setDraggingTaskDimensions,
  tasksStore,
}: {
  task: Task;
  setDraggingTask: React.Dispatch<React.SetStateAction<Task | null>>;
  setDraggingTaskDimensions: React.Dispatch<
    React.SetStateAction<{ width: number; height: number } | null>
  >;
  tasksStore: TasksStore;
}) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);
  return (
    <div
      key={task.id}
      className="flex flex-col task-container rounded shadow border p-4 space-y-2 mt-2 hover:shadow-lg z-10"
      onMouseDown={(e) => {
        e.preventDefault();
        setDraggingTask(task);
        setDraggingTaskDimensions({
          // @ts-ignore
          width: e.target.offsetWidth,
          // @ts-ignore
          height: e.target.offsetHeight,
        });
      }}
      style={{ cursor: "pointer" }}
      data-column-id={task.id}
    >
      <div className="flex space-x-2 items-center">
        <img src="/file.png" alt="icon" />
        <input
          type="text"
          className="shadow-none flex-1 z-30"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          onBlur={(e) => {
            runInAction(() => {
              task.title = title;
            });
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              // @ts-ignore
              e.target.blur();
            }
          }}
          onMouseUp={(e) => {
            e.stopPropagation();
          }}
        />
      </div>
      <div className={`design-${task.status}-tab task-status`}>
        <div className="point"></div>
        {task.status
          .replace(/-/g, " ")
          .replace(/(?:^|\s)\S/g, (match) => match.toUpperCase())}
      </div>
      <button
        className="delete-button"
        onClick={() => {
          runInAction(() => {
            delete tasksStore.tasks[task.id];
          });
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <img className="trash bg-red-400" src="/trash.svg" alt="delete" />
      </button>
    </div>
  );
}

export const TaskList = observer(() => {
  const tasksStore: any = useContext(StoreContext);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [draggingTaskDimensions, setDraggingTaskDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [draggingOverStatus, setDraggingOverStatus] = useState<string | null>(
    null
  );

  const ghostRef = useRef<HTMLDivElement>(null);

  useEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey && event.key === "z") {
        event.preventDefault();
        tasksStore.undo();
      }
      if (event.ctrlKey && event.key === "y") {
        event.preventDefault();
        tasksStore.redo();
      }
    },
    {
      target: document,
    }
  );

  return (
    <div
      className="main-content"
      onMouseMove={(e) => {
        if (draggingTask != null) {
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          const desiredElement = Array.from(elements).find(
            // @ts-ignore
            (element) => element.dataset.statusColumn != null
          );
          // @ts-ignore
          ghostRef.current.style.width = `${draggingTaskDimensions.width}px`;
          // @ts-ignore
          ghostRef.current.style.height = `${draggingTaskDimensions.height}px`;
          // @ts-ignore
          ghostRef.current.style.left = `${e.clientX}px`;
          // @ts-ignore
          ghostRef.current.style.top = `${e.clientY}px`;

          // @ts-ignore
          setDraggingOverStatus(desiredElement?.dataset?.statusColumn);
        }
      }}
      onMouseUp={() => {
        setDraggingTask(null);
        setDraggingOverStatus(null);
        setDraggingTaskDimensions(null);
        // @ts-ignore
        ghostRef.current.style.width = "0px";
        // @ts-ignore
        ghostRef.current.style.height = "0px";
        // @ts-ignore
        ghostRef.current.style.left = "0px";
        // @ts-ignore
        ghostRef.current.style.top = "0px";
        if (draggingOverStatus != null && draggingTask != null) {
          runInAction(() => {
            tasksStore.tasks[draggingTask.id].status = draggingOverStatus;
          });
        }
      }}
    >
      <div className="flex justify-center space-x-4">
        <button
          onClick={() => {
            tasksStore.undo();
          }}
        >
          Undo
        </button>

        <button
          onClick={() => {
            tasksStore.redo();
          }}
        >
          Redo
        </button>
      </div>
      <div
        ref={ghostRef}
        className="fixed left-0 top-0 w-0 h-0 border-4 border-dashed bg-transparent -translate-x-1/2 -translate-y-1/2"
      />
      <div className="flex justify-around">
        {Object.keys(tasksStore.statusOrder).map((status) => {
          const tasks = tasksStore.tasksByStatus[status] || [];
          // @ts-ignore
          return (
            <div
              key={status}
              className={cx("w-45 min-x-[50vh] p-4 border-2 border-dashed", {
                "border-indigo-500": status === draggingOverStatus,
                "border-transparent": status !== draggingOverStatus,
              })}
              data-status-column={status}
            >
              <div className={`design-${status}-tab`}>
                <div className="point"></div>
                {status.toUpperCase()}
              </div>

              <div>
                <div>
                  {tasks.map((task: any) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      setDraggingTask={setDraggingTask}
                      setDraggingTaskDimensions={setDraggingTaskDimensions}
                      tasksStore={tasksStore}
                    />
                  ))}
                  <div
                    className="plus"
                    onClick={() => {
                      const id = nanoid(6);
                      runInAction(() => {
                        tasksStore.tasks[id] = {
                          id,
                          title: "No Title",
                          status,
                        };
                      });
                    }}
                    style={{ width: "15rem", cursor: "pointer" }}
                  >
                    <img src="/plus.png" alt="plus" />
                    <span>New</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function App() {
  const tasksStore = useMemo(() => new TasksStore(), []);
  return (
    <StoreContext.Provider value={tasksStore}>
      <div className="App">
        <TaskList />
      </div>
    </StoreContext.Provider>
  );
}

export default App;
