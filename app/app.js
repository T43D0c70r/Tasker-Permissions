import { EventBus } from "../js/eventbus.js";
import { ADBDevice, ADBDevices, ControlADBDevices } from "./adbdevice/adbdevices.js";
import { ADBPermissions, ControlADBPermissions } from "./adbpermission/adbpermissions.js";
import { AndroidApps, ControlAndroidApps } from "./androidapps/androidapps.js";
import { Control } from "./control.js";
import { UtilDOM } from "./utildom.js";
export class App extends Control {
    constructor() {
        super();
    }
    get html(){
        return `
        <div id="app">
            <div id="androidAppsRoot"></div>
            <div id="adbDevicesRoot"></div>
            <div id="adbPermissionsRoot"></div>
        </div>`;
    }
    get css(){
        return `
        html,body{
            margin: 0px;
        }
        .hidden{
            display: none !important;
        }
        `;
    }
    async render(){
        const result = await super.render();
        console.log("Rendering...");
        window.api.receive("eventbus", async ({data,className}) => {
           await EventBus.post(data,className);
        });
        // ServerEventBus.post(new RequestTest());

        window.oncontextmenu = () => ServerEventBus.post(new RequestToggleDevOptions());
        await this.renderAll();
        EventBus.register(this);
        return result;
    }
    async renderAll(){
        await this.renderAndroidApps();
        await this.renderDevices();
        await this.renderPermissions();  
    }
    async onResponseTest(){
        console.log("Response test");
    }
    async renderAndroidApps(){
        this.controlAndroidApps = new ControlAndroidApps();
        const androidAppsRoot = await this.$("#androidAppsRoot");
        await this.renderInto(this.controlAndroidApps,androidAppsRoot);
    }
    async renderDevices(){
        const devicesRoot = await this.$("#adbDevicesRoot");

        const adbDevices = await this.adbDevices;

        this.controlADBDevices = new ControlADBDevices(adbDevices, this.selectedAndroidApp);
        await this.renderInto(this.controlADBDevices,devicesRoot);
    }
    async onSelectedDevice(){
        await this.renderPermissions();
    }
    async onSelectedAndroidApp(){
        await this.renderDevices();
        await this.renderPermissions();
    }
    async renderPermissions(){
        const elementPermissionsRoot = await this.$("#adbPermissionsRoot");
        elementPermissionsRoot.innerHTML = "Loading permissions...";

        if(!this.selectedDeviceControl){
            elementPermissionsRoot.innerHTML = "";
    
            return;
        }
        const adbPermissions = await this.adbPermissions;
        console.log("Permissions dump",adbPermissions);

        this.controlADBPermissions = new ControlADBPermissions(adbPermissions)
        await this.renderInto(this.controlADBPermissions,elementPermissionsRoot);
    }
    async grantAllPermissions(){
        const adbPermissions = (await this.adbPermissions).filter(permission => !permission.granted);
        const length = adbPermissions.length;

        if(length == 0){
            alert("All permissions already granted!");
            return;
        }

        const grant = confirm(`Grant ${length} missing permissions?`);
        if(!grant) return;

        for(const adbPermission of adbPermissions){
            const result = await this.grantRevokePermission(adbPermission,true);
            const wasGood = await this.handleGrantRevokePermissionResult(result);
            if(!wasGood) return;
        }
        alert("Done!");
        await this.renderPermissions();
    }
    async grantRevokePermission(adbPermission, grant){
        const command = await adbPermission.getCommand(grant);
        return await this.runAdbCommand(command);
    }
    async handleGrantRevokePermissionResult(result){
        const error = result.error;
        if(error){
            if(error.includes("GRANT_RUNTIME_PERMISSIONS")){
                alert(`It seems like you're on device that requires some special permissions for ADB to be able to grant permissions on your phone. Can you please enable the option "Disable permission Monitoring" or "USB Debugging (Security Settings)" under "Developer options" and then try again? After doing that you might need to disable and re-enable USB Debugging on your device for it to work.`)
            }else{
                alert(`Error: ${error}`);
            }
            return false;
        }
        return true;
    }
    async onRequestGrantAllPermissions(){
        await this.grantAllPermissions();
    }
    async onRequestGrantRevokePermission(request){
        console.log("Granting/revoking permission with request", request);        
        const result = await this.grantRevokePermission(request.adbPermission, request.grant);
        console.log("Grant result",result);

        this.handleGrantRevokePermissionResult(result);
        await this.renderPermissions();  
    }
    get adbDevices(){
        return (async ()=>{
            const rawResult = (await this.runAdbCommand("devices -l")).out;
            const startOfList = rawResult.substring(rawResult.indexOf("\n")+1);
            const split = startOfList.split("\n");
            return new ADBDevices(split.map(deviceRaw=>{
                const result = deviceRaw.replaceAll("\r","");
                const id = deviceRaw.substring(0,result.indexOf(" "));
                if(!id) return null;

                try{
                    const model = result.match(/model:([^ ]+)/)[1];
                    const device = result.match(/device:([^ ]+)/)[1];
                    return new ADBDevice({id, model,device});                        
                }catch{
                    return new ADBDevice({id, model:"unknown",device:"unknown"});                  
                }
            }).filter(device=>device ? true : false));
        })();
    }    
    get selectedDeviceControl(){
        if(!this.controlADBDevices) return null;

        return this.controlADBDevices.selectedDeviceControl;
    }
    get selectedAndroidApp(){
        if(!this.controlAndroidApps) return null;

        return this.controlAndroidApps.selectedAndroidApp.androidApp;
    }
    async getAppOppsPermissionGranted(permission){
        const result = (await this.runAdbShellCommand(`appops get ${this.selectedAndroidApp.packageName} ${permission}`)).out;
        if(!result || !result.includes("allow")) return false;

        return true;
    }
    async getSettingGranted(permission){
        const result = (await this.runAdbShellCommand(`settings get global ${permission}`)).out;
        if(!result || !result.includes("1")) return false;

        return true;
    }
    get adbPermissions(){
        return (async ()=>{
            const dump = await this.adbPermissionsDump;
            return new ADBPermissions(dump,this.selectedAndroidApp);
        })();
    }
    get adbPermissionsDump(){
        return (async ()=>{
            const rawResult = (await this.runAdbShellCommand(`dumpsys package ${this.selectedAndroidApp.packageName}`)).out;
            const permissionRelated = rawResult.split("\n").filter(line => line.includes(": granted="));
            const result = permissionRelated.map(permissionLine=>{
                const match = permissionLine.match(/([^:]+): granted=([^\r,]+)/);
                return {permission:match[1].trim(),granted:match[2] == "true" ? true: false};
            });
            const addAppOpsPermission = async permission => {             
                const granted = await this.getAppOppsPermissionGranted(permission);
                result.push({permission,granted});
            }
            const addSettingPermission = async permission => {             
                const granted = await this.getSettingGranted(permission);
                result.push({permission,granted});
            }
            await addAppOpsPermission("PROJECT_MEDIA");
            await addAppOpsPermission("SYSTEM_ALERT_WINDOW");
            await addAppOpsPermission("GET_USAGE_STATS");
            await addAppOpsPermission("WRITE_SETTINGS");
            await addSettingPermission("hidden_api_policy");
            return result;
        })();
    }
    async runAdbShellCommand(command){
        return await this.runAdbCommand(`shell "${command}"`);
    }
    async runAdbCommand(commandInput){
        let command = "bin/adb.exe";
        const selectedDevice = await this.selectedDeviceControl;
        if(selectedDevice){
            command += ` -s ${selectedDevice.adbDevice.id}`;
        }
        command += ` ${commandInput}`;
        return await this.runCommandLine(command,null,true);
    }
    async runCommandLine(command, args, prependCurrentPath){
        console.log("Running command line",command,args);
        const response = await ServerEventBus.postAndWaitForResponse(new RequestRunCommandLineCommand({command,args,prependCurrentPath}),ResponseRunCommandLineCommand,10000);
        console.log("Ran command line. Response:",response);
        return response;
    }
    async onRequestConsoleLog(log){
        console.log("Log from server",log);
    }
    async onRequestReloadDevices(){
        await this.renderAll();
    }
    async onRequestRunAdbCommand({command}){     
        console.log("onRequestRunAdbCommand", command);
        const result = await this.runAdbCommand(command);
        console.log("onRequestRunAdbCommand result", result);
        if(result.error){
            alert(result.error);
        }else{
            alert("Success!")
        }
    }
}

class RequestRunCommandLineCommand{
    constructor(args = {command,args,prependCurrentPath}){
        Object.assign(this,args);
    }
}
export class ResponseRunCommandLineCommand{}

class RequestToggleDevOptions{}
export class ServerEventBus{
    static async post(object){
        try{
            await window.api.send('eventbus', {data:object,className:object.constructor.name});
        }catch{
            let data = {data:object,className:object.constructor.name};
            data = JSON.stringify(data);
            data = JSON.parse(data);
            await window.api.send('eventbus', data);
        }
    }
    static async postAndWaitForResponse(object,repsonseClzz,timeout){
        const responsePromise = EventBus.waitFor(repsonseClzz,timeout);
        ServerEventBus.post(object);
        return responsePromise;
    }
}

class RequestTest{}