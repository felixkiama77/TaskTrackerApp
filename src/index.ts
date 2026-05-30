class Task {
    readonly internalId: number;
    readonly title: string;
    dueDate: string;
    state: boolean;
    tags: string[] = [];
    priority: string;

    constructor(id: number, name: string, dueD: string, level: string) {
        this.internalId = id;
        this.title = name;
        this.dueDate = dueD;
        this.state = false;
        this.priority = level;
    }

    getID(): number {
        return this.internalId;
    }

    getName(): string {
        return this.title;
    }

    getDueDate(): string {
        return this.dueDate;
    }

    getPriority(): string {
        return this.priority;
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
        let s: string = '\nTask #'+ this.internalId + '\nTask Name: ' + this.title + '\nDue Date: ' + this.dueDate + '\nComplete: ' + this.state;
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
    idTracker: number;
    readonly taskList: Task[] = [];
    tagList: TaskTag[] = [];

    constructor() {
        this.retrieveData();
        this.idTracker = Math.max(0, ...this.taskList.map(t => t.internalId)) + 1;
    }

    private getNextAvailableId(): number {
        let id: number = 1;
        while (this.taskList.some(task => task.internalId === id)) {
            id++;
        }
        return id;
    }    

    addTask(name: string, due: string, level: string) {
        const task = new Task(this.getNextAvailableId(), name, due, level);
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
            this.storeData();
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
                const task = new Task(obj.internalId, obj.title, obj.dueDate, obj.priority);
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
const taskPriority = document.getElementById("task-priority") as HTMLSelectElement;
const createButton = document.getElementById("create-task") as HTMLButtonElement;
const printTask = document.getElementById("task-list") as HTMLOutputElement;
const outputTags = document.getElementById("tag-list") as HTMLOutputElement;
const tagFormOutput = document.getElementById("create-tag") as HTMLDivElement;
const tagMenuButton = document.getElementById("create-tag-button") as HTMLButtonElement;


function createAndPrintTask(event: Event): void {
    event.preventDefault();
    manager.addTask(taskName.value, dueDate.value, taskPriority.value);
    printTask.style.whiteSpace = 'pre-line';
    manager.storeData();
    renderTask();
}

function showAllTasks(): void {
    for (let t of manager.taskList) {
        console.log("Taks ID #" + t.internalId + " Task Name: " + t.title + "   ");
    }
}

function showTagList(): void {
    const printTags = document.createElement("section");
    printTags.classList.add("show-sections");
    printTags.style.whiteSpace = 'pre-line';
    let tagNum: number = 0;
    const tagTitle = document.createElement("h2");
    tagTitle.textContent = "Task Catagories:";
    tagTitle.id = "tag-section-title";
    printTags.append(tagTitle);
    for (let tag of manager.tagList) {
        tagNum++;
        const tagObject = document.createElement("section");
        tagObject.classList.add("tag-display-objects");
        const tagTitle = document.createElement("h3");
        tagTitle.classList.add("tag-object-titles");
        tagTitle.textContent = "Category #" + tagNum + ": " +  tag.tagName;
        tagObject.append(tagTitle);
        const deleteTag = document.createElement("button");
        deleteTag.classList.add("delete-tag-object-buttons");
        deleteTag.textContent = "Delete Category " + tag.tagName;
        deleteTag.addEventListener("click", () => {
            manager.deleteTag(tag);
            renderTask();
            showAllTasks();
        });
        tagObject.append(deleteTag);
        const tagTasksList = document.createElement("ul");
        tagTasksList.classList.add("tags-tasks-section");
        for (let tagT of tag.typeList) {
            const taskTObj = document.createElement("li");
            taskTObj.classList.add("task-display-elements");
            taskTObj.textContent = 
            "Task #" + tagT.internalId +
            " | " + tagT.title +
            " | Categories: " + tagT.showTags() +
            " | Due: " + tagT.dueDate +
            " | Priority: " + tagT.priority +
            " | Done: " + tagT.state;

            const buttonContain = document.createElement("div");
            const deleteButton = document.createElement("button");
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => {
                manager.removeTask(tagT.internalId);
                manager.storeData();
                renderTask();
            });
            buttonContain.append(deleteButton);

            const completeButton = document.createElement("button");
            completeButton.textContent = "Toggle Complete";
            completeButton.addEventListener("click", () => {
                manager.completeTask(tagT.internalId);
                manager.storeData();
                renderTask();
            });
            buttonContain.append(completeButton);
            buttonContain.classList.add("button-containers")
            taskTObj.append(buttonContain);
            tagTasksList.append(taskTObj);
        }
        tagObject.append(tagTasksList);
        printTags.append(tagObject);
    }
    outputTags.append(printTags);
}

function openTagMenu(event: Event): void {
    event.preventDefault();
    if (tagFormOutput.innerHTML !== "") {
        tagFormOutput.innerHTML = "";
        tagMenuButton.innerHTML = "Open Create A Tag Menu";
        return;
    } else {
        tagMenuButton.innerHTML = "Close Create A Tag Menu";
        tagFormOutput.innerHTML = "";
        const inputTagSection = document.createElement("section");
        const inputTagTitle = document.createElement("h2");
        inputTagTitle.id = "add-tags-title";
        inputTagSection.append(inputTagTitle);
        inputTagSection.classList.add("create-tags");
        const inputTagForm = document.createElement("form");
        const tagNamePrompt = document.createElement("label");
        const tagNameInput = document.createElement("input");
        const containNameInput = document.createElement("div");
        inputTagForm.classList.add("input-forms");
        tagNameInput.name = "category";
        tagNameInput.id = "input-tag-name";
        tagNamePrompt.textContent = "Enter category";
        tagNamePrompt.htmlFor = "input-tag-name";
        containNameInput.append(tagNamePrompt);
        containNameInput.append(tagNameInput);
        containNameInput.classList.add("tag-input-divs");
        const inputTaskPrompt = document.createElement("label");
        inputTaskPrompt.textContent = "Enter the number of Task(s) to add to the Category";
        const tagTask = document.createElement("input");
        tagTask.name = "Task";
        tagTask.id = "input-tag-task";
        inputTaskPrompt.htmlFor = "input-tag-task";
        const containTaskInput = document.createElement("div");
        containTaskInput.append(inputTaskPrompt);
        containTaskInput.append(tagTask);
        containTaskInput.classList.add("tag-input-divs");
        const createTagButton = document.createElement("button");
        createTagButton.type = "button";
        createTagButton.textContent = "Create Tag";
        createTagButton.addEventListener("click", () => {
            manager.retrieveData();
            let taskIndex: number = Number(tagTask.value);
            if (taskIndex) {
                manager.createTag(taskIndex, tagNameInput.value);
                manager.storeData();
                renderTask();
            }
        });
        inputTagForm.append(containNameInput);
        inputTagForm.append(containTaskInput);
        inputTagForm.append(createTagButton);
        inputTagSection.append(inputTagForm);
        tagFormOutput.append(inputTagSection);
    }
}

function renderTask() {
    printTask.innerHTML = "";
    const taskSection = document.createElement("section");
    taskSection.classList.add("show-sections");
    const taskListObject = document .createElement("ul");
    taskListObject.classList.add("tags-tasks-section");
    for (let task of manager.taskList) {
        const taskObj = document.createElement("li");

        taskObj.textContent = 
        "Task #" + task.internalId +
        " | " + task.title +
        " | Categories: " + task.showTags() +
        " | Due: " + task.dueDate +
        " | Priority: " + task.priority +
        " | Done: " + task.state;
        
        const buttonContain = document.createElement("div");
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
            manager.removeTask(task.internalId);
            manager.storeData();
            renderTask();
        });
        buttonContain.append(deleteButton);

        const completeButton = document.createElement("button");
        completeButton.textContent = "Toggle Complete";
        completeButton.addEventListener("click", () => {
            manager.completeTask(task.internalId);
            manager.storeData();
            renderTask();
        });
        buttonContain.append(completeButton);
        buttonContain.classList.add("button-containers");
        taskObj.append(buttonContain);
        taskObj.classList.add("task-objects");
        taskListObject.append(taskObj);
    }
    taskSection.append(taskListObject);
    printTask.append(taskSection);
    outputTags.innerHTML = "";
    showTagList();
}
createButton.addEventListener("click", createAndPrintTask);
tagMenuButton.addEventListener("click", openTagMenu);





