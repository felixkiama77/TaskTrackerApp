class Task {
    readonly internalId: number;
    readonly title: string;
    id: number = 0;
    dueDate: string;
    state: boolean;
    tags: string[] = [];

    constructor(id: number, name: string, dueD: string) {
        this.internalId = id;
        this.title = name;
        this.dueDate = dueD;
        this.state = false;
    }

    getID(): number {
        return this.id;
    }

    getName(): string {
        return this.title;
    }

    getDueDate(): string {
        return this.dueDate;
    }

    getState(): boolean {
        return this.state;
    }

    addTag(tagName: string) {
        this.tags.push(tagName);
    }

    removeTag(tagName: string) {
        const index = this.tags.findIndex(s => s === tagName);
        if (index !== -1) {
            this.tags.splice(index, 1);
        }
    }

    showTags(): string {
        let s: string = '';
        if (this.tags.length !== 0) {
            for (let t of this.tags) {
            s += t + " ";
            }
        } else {
            s += ('No Tags');
        }
        return s;
    }

    setState() {
        if (this.state === true) {
            this.state = false;
        } else {
            this.state = true;
        }
    }

    printTask() {
        let s: string = '\nTask #'+ this.id + '\nTask Name: ' + this.title + '\nDue Date: ' + this.dueDate + '\nComplete: ' + this.state;
        return s;
    }
}

class TaskTag {
    taskCount: number;
    tagName: string;
    readonly typeList: Task[] = [];

    constructor(task: Task | null, name: string) {
        this.tagName = name;
        this.taskCount = 0;
        if (task !== null) {
            this.addToList(task);
        }
    }

    addToList(task: Task) {
        this.typeList.push(task);
        task.addTag(this.tagName);
        this.taskCount += 1;
    }

    removeFromList(task: Task) {
        const index = this.typeList.findIndex(t => t.internalId == task.internalId);
        if (index !== -1) {
            this.typeList.splice(index, 1);
            this.taskCount -= 1;
        }
    }

    delete() {
        for (let t of this.typeList) {
            t.removeTag(this.tagName);
        }
    }
}

class ManageTask {
    idTracker: number = 1;
    readonly taskList: Task[] = [];
    tagList: TaskTag[] = [];

    constructor() {
        this.retrieveData();
    }

    addTask(name: string, due: string) {
        const task = new Task(this.idTracker++, name, due);
        this.taskList.push(task);
    }

    removeTask(taskID: number) {
        const index = this.taskList.findIndex(t => t.internalId === taskID);
        if (index !== -1) {
            const task = this.taskList.at(index);
            if (task) {
                for (let t of this.tagList) {
                    t.removeFromList(task);
                }
            }
            this.taskList.splice(index, 1);
        } else {
            console.log("Task not found!");
        }
    }

    getList(): string {
        let print: string = '\nTask List:\n';
        for (let t of this.taskList) {
            let show: string = t.printTask();
            print = print.concat(show + '\n');
        }
        return print;
    }

    completeTask(taskID: number): void {
        const task = this.taskList.find(t => t.internalId === taskID);
        if (task) {
            task.setState();
        } else {
            console.log("Task not found!");
        }
    }

    createTag(taskNum: number, tagName: string): void {
        if (this.validNewTag(tagName)) {
            if (taskNum === 0) {
                const tag = new TaskTag(null, tagName);
                this.tagList.push(tag);
            } else {
                const task = this.taskList.find(t => t.internalId === taskNum);
                if (task) {
                    const tag = new TaskTag(task, tagName);
                    this.tagList.push(tag);
                } else {
                    console.log("Could not find a Task with the Number #" + taskNum);
                    const tag = new TaskTag(null, tagName);
                    this.tagList.push(tag);
                }
            }
        } else {
            if (taskNum !== 0) {
                const task = this.taskList.find(t => t.internalId === taskNum);
                if (task) {
                    this.addToTag(task, tagName);
                } else {
                    console.log("Could not find a Task with the Number #" + taskNum);
                }
            }
        }
    }

    addToTag(task: Task, tagName: string): void {
        if (!this.validNewTag(tagName)) {
            const tag = this.tagList.find(t => t.tagName === tagName);
            if (tag) {
                tag.addToList(task);
            } else {
                console.log("Could not find a Tag with the Title " + tagName);
            }
        }
    }

    validNewTag(tagName: string): boolean {
        let pass: boolean = true;
        for (let t of this.tagList) {
            if (t.tagName === tagName) {
                pass = false;
            }
        }
        return pass;
    }

    deleteTag(tag: TaskTag) {
        tag.delete();
        const index = this.tagList.findIndex(t => t.tagName === tag.tagName);
        if (index !== -1) {
            this.tagList.splice(index, 1);
        } else {
            console.log("WARNING: Could not find Tag to delete!");
        }
    }

    storeData(): void {
        localStorage.setItem("Tasks", JSON.stringify(this.taskList));
        localStorage.setItem("Tags", JSON.stringify(this.tagList));
    }

    retrieveData(): void {
        const taskData = localStorage.getItem("Tasks");
        if (taskData) {
            const parsedData = JSON.parse(taskData);
            const newList: Task[] = parsedData.map((obj: any) => {
                const task = new Task(obj.id, obj.title, obj.dueDate);
                task.state = obj.state;
                task.tags = Array.isArray(obj.tags) ? obj.tags : [];
                return task;
            });
            this.taskList.length = 0;
            this.taskList.push(...newList);
        }
        const tagData = localStorage.getItem("Tags");
        if (tagData) {
            const parsedData = JSON.parse(tagData);
            const newTagList: TaskTag[] = parsedData.map((obj: any) => {
                const tag = new TaskTag(null, obj.tagName);
                tag.taskCount = obj.taskCount;
                const listOfTasks: Task[] = [];
                for (let t of this.taskList) {
                    if (t.tags.includes(tag.tagName)) {
                        listOfTasks.push(t);
                    }
                }
                tag.typeList.length = 0;
                tag.typeList.push(...listOfTasks);
                return tag;
            });
            this.tagList.length = 0;
            this.tagList.push(...newTagList);
        }
    }
}
const manager = new ManageTask();



document.addEventListener("DOMContentLoaded", renderTask);
const taskName = document.getElementById("task-name") as HTMLInputElement;
const dueDate = document.getElementById("due-date") as HTMLInputElement;
const createButton = document.getElementById("create-task") as HTMLButtonElement;
console.log("is this working?");
const printTask = document.getElementById("task-list") as HTMLOutputElement;
const tagMenuButt = document.getElementById("tag-button") as HTMLButtonElement;
const printTags = document.getElementById("tag-list") as HTMLOutputElement;
const tagForm = document.getElementById("create-tag") as HTMLDivElement;


function createAndPrintTask(event: Event): void {
    event.preventDefault();
    manager.addTask(taskName.value, dueDate.value);
    printTask.style.whiteSpace = 'pre-line';
    manager.storeData();
    renderTask();
}

function showTagList(): void {
    printTags.innerHTML = "";
    printTags.style.whiteSpace = 'pre-line';
    let tagNum: number = 0;
    const tagTitle = document.createElement("h2");
    tagTitle.textContent = "Task Catagories:";
    printTags.appendChild(tagTitle);
    for (let tag of manager.tagList) {
        console.log(tag.tagName);
        tagNum++;
        const tagTitle = document.createElement("h3");
        tagTitle.textContent = "Catagory #" + tagNum + ": " +  tag.tagName;
        printTags.appendChild(tagTitle);
        const deleteTag = document.createElement("button");
        deleteTag.textContent = "Delete Catagory " + tag.tagName;
        deleteTag.addEventListener("click", () => {
            manager.deleteTag(tag);
            manager.storeData();
            renderTask();
        });
        printTags.appendChild(deleteTag);
        for (let tagT of tag.typeList) {
            const taskTObj = document.createElement("div");
            taskTObj.textContent = 
            "Task #" + tagT.id +
            " | " + tagT.title +
            " | Categories: " + tagT.showTags() +
            " | Due: " + tagT.dueDate +
            " | Done: " + tagT.state;
            const deleteButton = document.createElement("button");
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => {
                manager.removeTask(tagT.internalId);
                manager.storeData();
                renderTask();
            });
            taskTObj.appendChild(deleteButton);

            const completeButton = document.createElement("button");
            completeButton.textContent = "Toggle Complete";
            completeButton.addEventListener("click", () => {
                manager.completeTask(tagT.internalId);
                manager.storeData();
                renderTask();
            });
            taskTObj.appendChild(completeButton);
            printTags.appendChild(taskTObj);
        }
    }
}

function openTagMenu(event: Event): void {
    event.preventDefault();
    tagForm.innerHTML = "";
    const inputTagForm = document.createElement("form");
    const tagNamePrompt = document.createElement("label");
    const tagNameInput = document.createElement("input");
    tagNameInput.name = "category";
    tagNameInput.id = "input-tag-name";
    tagNamePrompt.textContent = "Enter Catagory";
    tagNamePrompt.htmlFor = "input-tag-name";
    const inputTaskPrompt = document.createElement("label");
    inputTaskPrompt.textContent = "Enter the number of Task(s) to add to the Category";
    const tagTask = document.createElement("input");
    tagTask.name = "Task";
    tagTask.id = "input-tag-task";
    inputTaskPrompt.htmlFor = "input-tag-task";
    const createTagButton = document.createElement("button");
    createTagButton.type = "button";
    createTagButton.textContent = "Create Tag";
    createTagButton.addEventListener("click", () => {
        let taskIndex: number = Number(tagTask.value);
        if (taskIndex) {
            manager.createTag(taskIndex, tagNameInput.value);
            manager.storeData();
            renderTask();
        }
    });
    inputTagForm.appendChild(tagNamePrompt);
    inputTagForm.appendChild(tagNameInput);
    inputTagForm.appendChild(inputTaskPrompt);
    inputTagForm.appendChild(tagTask);
    inputTagForm.appendChild(createTagButton);
    tagForm.appendChild(inputTagForm);
}

function renderTask() {
    printTask.innerHTML = "";
    let realId: number = 1;

    for (let task of manager.taskList) {
        const taskObj = document.createElement("div");
        task.id = realId++;

        taskObj.textContent = 
        "Task #" + task.id +
        " | " + task.title +
        " | Categories: " + task.showTags() +
        " | Due: " + task.dueDate +
        " | Done: " + task.state;
        
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
            manager.removeTask(task.internalId);
            manager.storeData();
            renderTask();
        });
        taskObj.appendChild(deleteButton);

        const completeButton = document.createElement("button");
        completeButton.textContent = "Toggle Complete";
        completeButton.addEventListener("click", () => {
            manager.completeTask(task.internalId);
            manager.storeData();
            renderTask();
        });
        taskObj.appendChild(completeButton);

        printTask.appendChild(taskObj);
    }
    showTagList();
}
createButton.addEventListener("click", createAndPrintTask);
tagMenuButt.addEventListener("click", openTagMenu);





