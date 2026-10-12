export type User={id:string;email:string;display_name:string;role:'admin'|'employee';active?:boolean};
export type Project={id:string;name:string;description:string;owner_id:string;my_role?:string;archived:boolean};
export type Task={id:string;project_id:string;title:string;description:string;status:'todo'|'in_progress'|'review'|'done'|'cancelled';priority:'low'|'normal'|'high'|'urgent';assignee_id?:string|null;due_at?:string|null;version:number;updated_at:string};
export type Conversation={id:string;name:string;kind:'direct'|'group'};
export type Message={id:string;conversation_id:string;sender_id:string;body:string;created_at:string};

const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
let token=localStorage.getItem('corp_token')||'';
export const auth={get token(){return token},set(t:string){token=t;localStorage.setItem('corp_token',t)},clear(){token='';localStorage.removeItem('corp_token')}};
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(init.headers); headers.set('Content-Type','application/json'); if(token)headers.set('Authorization',`Bearer ${token}`);
 const r=await fetch(`${API}${path}`,{...init,headers});
 if(r.status===401){auth.clear();window.dispatchEvent(new Event('auth:expired'));}
 const data=await r.json().catch(()=>({})); if(!r.ok)throw new Error(typeof data.message==='string'?data.message:'Ошибка запроса'); return data as T;
}
const get=<T>(p:string)=>request<T>(p);
const post=<T>(p:string,b:unknown)=>request<T>(p,{method:'POST',body:JSON.stringify(b)});
const patch=<T>(p:string,b:unknown)=>request<T>(p,{method:'PATCH',body:JSON.stringify(b)});
export const api={
 login:(email:string,password:string)=>post<{access_token:string}>('/api/auth/login',{email,password}),
 me:()=>get<User>('/api/auth/me'),
 projects:()=>get<Project[]>('/api/projects?limit=100'),
 createProject:(name:string,description:string)=>post<Project>('/api/projects',{name,description}),
 members:(id:string)=>get<User[]>(`/api/projects/${id}/members`),
 tasks:(id:string)=>get<Task[]>(`/api/projects/${id}/tasks?limit=100`),
 createTask:(id:string,b:Partial<Task>)=>post<Task>(`/api/projects/${id}/tasks`,b),
 updateTask:(id:string,b:Partial<Task>&{version:number})=>patch<Task>(`/api/tasks/${id}`,b),
 comments:(id:string)=>get<{id:string;body:string;author_id:string;created_at:string}[]>(`/api/tasks/${id}/comments?limit=100`),
 addComment:(id:string,body:string)=>post(`/api/tasks/${id}/comments`,{body}),
 users:()=>get<User[]>('/api/users?limit=100'),
 createUser:(b:{email:string;display_name:string;password:string;role:'admin'|'employee'})=>post<User>('/api/users',b),
 setActive:(id:string,active:boolean)=>patch(`/api/users/${id}/active`,{active}),
 conversations:()=>get<Conversation[]>('/api/conversations?limit=100'),
 createConversation:(name:string,kind:'direct'|'group',member_ids:string[])=>post<Conversation>('/api/conversations',{name,kind,member_ids}),
 messages:(id:string)=>get<Message[]>(`/api/conversations/${id}/messages?limit=100`),
 sendMessage:(id:string,body:string)=>post<Message>(`/api/conversations/${id}/messages`,{body,client_id:crypto.randomUUID()})
};
