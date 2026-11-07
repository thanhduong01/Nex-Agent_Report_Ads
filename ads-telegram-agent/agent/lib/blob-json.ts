import { get, head, BlobError, BlobNotFoundError, BlobPreconditionFailedError } from "@vercel/blob";

export async function readBlobJson(path:string,forWrite=false):Promise<{value:unknown;etag:string}|null> {
  const abortSignal=AbortSignal.timeout(15000);
  if(!forWrite) {
    const result=await get(path,{access:"private",useCache:false,abortSignal});
    return result?{value:await new Response(result.stream).json(),etag:result.blob.etag}:null;
  }
  // A download's HTTP validator can describe a compressed/weak representation.
  // Conditional uploads need the storage API's canonical, strong ETag instead.
  // Bracket the uncached body read with metadata reads so the content and ETag
  // belong to one version; fetching metadata only after the body could lose edits.
  for(let attempt=0;attempt<3;attempt++) {
    let before;
    try {before=await head(path,{abortSignal});}
    catch(error) {if(error instanceof BlobNotFoundError)return null;throw error;}
    if(!before.etag || before.etag.startsWith("W/"))throw new BlobError("Storage did not return a strong write validator.");
    const result=await get(path,{access:"private",useCache:false,abortSignal});
    if(!result)continue;
    const value:unknown=await new Response(result.stream).json();
    try {
      const after=await head(path,{abortSignal});
      if(before.etag===after.etag)return {value,etag:after.etag};
    }catch(error) {if(!(error instanceof BlobNotFoundError))throw error;}
  }
  throw new BlobPreconditionFailedError();
}
