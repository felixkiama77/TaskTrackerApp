
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({input, output});
let run: boolean = true;

class Task {
    readonly id: number;
    readonly title: string;
    dueDate: string;
    state: boolean;

    constructor(id: number, name: string, dueD: string) {
        this.id = id;
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

class ManageTask {
    idTracker: number = 1;
    readonly taskList: Task[] = [];

    constructor() {}

    addTask(name: string, due: string) {
        const task = new Task(this.idTracker++, name, due);
        this.taskList.push(task);
    }

    removeTask(taskID: number) {
        const index = this.taskList.findIndex(t => t.id === taskID);
        if (index !== -1) {
         this.taskList.splice(index, 1);
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

    completeTask(taskID: number) {
        const task = this.taskList.find(t => t.id === taskID);
        if (task) {
            task.setState();
        } else {
            console.log("Task not found!");
        }
    }
}

let option: string = '\nOPTIONS:\nMark A Task Complete[m]\nAdd A New Task[n]\nDelete A Task[d]\nPrint List[p]\nExit App[x]';
const start = await rl.question('\n\nCreate a task list and a new task? [y/n] ');
if (start === 'Y' || start === 'y') {
    let manager = new ManageTask();
    const taskName = await rl.question('\nWhat is the name of the Task? ');
    const taskDue = await rl.question('What is the due date? ');
    manager.addTask(taskName, taskDue);
    let display: string = manager.getList() + '\n';
    console.log(display);

    while(run) {
        const prompt = await rl.question(option + '\nEnter Your Option: ');
        if (prompt === 'n' || prompt === 'N') {
            const taskName = await rl.question('\nWhat is the name of the Task? ');
            const taskDue = await rl.question('What is the due date? ');
            manager.addTask(taskName, taskDue);
        } else if (prompt === 'd' || prompt === 'D') {
            let display: string = manager.getList() + '\n';
            console.log(display);
            const answer = await rl.question('\nEnter the # of the task you wish to delete from the list: ');
            let index: number = parseInt(answer);
            manager.removeTask(index);
        } else if (prompt === 'm' || prompt === 'M') {
            let display: string = manager.getList() + '\n';
            console.log(display);
            const index = await rl.question('\nEnter the # of the task you wish to mark done/undone: ');
            let taskNum: number = parseInt(index);
            manager.completeTask(taskNum);
            let newDisplay: string = manager.getList() + '\n';
            console.log(newDisplay);
        } else if (prompt === 'p' || prompt === 'P') {
            let display: string = manager.getList() + '\n';
            console.log(display);
        } else if (prompt === 'x' || prompt === 'X') {
            run = false;
        }
    }
}
console.log('\nThank you for using me!');
rl.close();
