import {ObjectId} from 'mongodb';
import {getCollection} from '../mongo.js';
import type {ClientSession} from 'mongodb';
import {withTransaction,InventoryError} from './inventory/helpers.js';
export async function retainContentFiles(text:string,session:ClientSession){
 const ids=[...new Set([...text.matchAll(/\/api\/content\/files\/([a-f0-9]{24})/gi)].map(m=>m[1]))];
 if(ids.length){const result=await(await getCollection<any>('TEP_TIN.files')).updateMany({_id:{$in:ids.map(id=>new ObjectId(id))}},{$set:{'metadata.lastUsedAt':new Date()}},{session});if(result.matchedCount!==ids.length)throw new InventoryError(400,'Có file không còn tồn tại. Hãy upload lại.');}
}
export async function cleanupContentFiles(){
 const cutoff=new Date(Date.now()-7*86400000);const files=await(await getCollection<any>('TEP_TIN.files')).find({'metadata.createdAt':{$lt:cutoff},$or:[{'metadata.lastUsedAt':{$exists:false}},{'metadata.lastUsedAt':{$lt:cutoff}}]}).limit(30).toArray();
 for(const file of files)await withTransaction(async session=>{
 const id=String(file._id),rx={$regex:id};
 const [blog,content,history]=await Promise.all([
 (await getCollection<any>('BAI_VIET')).findOne({$or:[{ANH_BIA:rx},{NOI_DUNG:rx},{'BAN_LAM_VIEC.ANH_BIA':rx},{'BAN_LAM_VIEC.NOI_DUNG':rx}]},{session}),
 (await getCollection<any>('NOI_DUNG_WEBSITE')).findOne({$or:[{'TEP_TIN.id':id},{NOI_DUNG_HTML:rx}]},{session}),
 (await getCollection<any>('LICH_SU_NOI_DUNG')).findOne({$or:[{'DU_LIEU_TRUOC.TEP_TIN.id':id},{'DU_LIEU_SAU.TEP_TIN.id':id},{'DU_LIEU_TRUOC.NOI_DUNG_HTML':rx},{'DU_LIEU_SAU.NOI_DUNG_HTML':rx}]},{session})]);
 if(blog||content||history)return;
 const deleted=await(await getCollection<any>('TEP_TIN.files')).deleteOne({_id:file._id,'metadata.createdAt':{$lt:cutoff},$or:[{'metadata.lastUsedAt':{$exists:false}},{'metadata.lastUsedAt':{$lt:cutoff}}]},{session});
 if(deleted.deletedCount)await(await getCollection<any>('TEP_TIN.chunks')).deleteMany({files_id:file._id},{session});
 });
}
