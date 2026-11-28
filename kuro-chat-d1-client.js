(function(global){
  "use strict";
  const CHAT_TABLES = new Set([
    "chat_conversations","chat_messages","chat_message_reads","chat_message_hides",
    "group_conversations","group_chat_members","group_chat_messages",
    "group_chat_message_reads","group_chat_mentions"
  ]);

  class KuroD1ChatQuery {
    constructor(client, table) {
      this.client = client;
      this.table = table;
      this.operation = "select";
      this.columns = "*";
      this.payload = null;
      this.filters = [];
      this.orders = [];
      this.limitValue = 100;
      this.cardinality = "";
      this.returning = false;
      this._promise = null;
    }
    select(columns) {
      this.columns = columns || "*";
      if (this.operation !== "select") this.returning = true;
      return this;
    }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    upsert(payload, options) { this.operation = "upsert"; this.payload = payload; this.upsertOptions = options || {}; return this; }
    delete() { this.operation = "delete"; return this; }
    eq(column,value) { this.filters.push({column,op:"eq",value}); return this; }
    neq(column,value) { this.filters.push({column,op:"neq",value}); return this; }
    gt(column,value) { this.filters.push({column,op:"gt",value}); return this; }
    gte(column,value) { this.filters.push({column,op:"gte",value}); return this; }
    lt(column,value) { this.filters.push({column,op:"lt",value}); return this; }
    lte(column,value) { this.filters.push({column,op:"lte",value}); return this; }
    is(column,value) { this.filters.push({column,op:"is",value}); return this; }
    in(column,values) { this.filters.push({column,op:"in",value:Array.isArray(values)?values:[]}); return this; }
    or(expression) { this.orExpression = String(expression || ""); return this; }
    order(column,options) {
      this.orders.push({column,ascending:!(options && options.ascending === false)});
      return this;
    }
    limit(value) { this.limitValue = Math.max(1,Math.min(500,Number(value)||100)); return this; }
    single() { this.cardinality = "single"; return this; }
    maybeSingle() { this.cardinality = "maybeSingle"; return this; }
    throwOnError() { this.throwErrors = true; return this; }
    then(resolve,reject) { return this.execute().then(resolve,reject); }
    catch(reject) { return this.execute().catch(reject); }
    finally(callback) { return this.execute().finally(callback); }
    execute() {
      if (this._promise) return this._promise;
      this._promise = (async()=>{
        try {
          const sessionResult = await this.client.auth.getSession();
          const token = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token;
          if (sessionResult && sessionResult.error) throw sessionResult.error;
          if (!token) return {data:null,error:{message:"ログイン状態を確認できません。",code:"AUTH_REQUIRED"}};
          const response = await fetch("/api/kuro-d1/chat", {
            method:"POST",
            credentials:"same-origin",
            cache:"no-store",
            headers:{
              "Content-Type":"application/json",
              "Authorization":"Bearer "+token,
              "Accept":"application/json"
            },
            body:JSON.stringify({
              table:this.table,
              operation:this.operation,
              columns:this.columns,
              payload:this.payload,
              filters:this.filters,
              orders:this.orders,
              limit:this.limitValue,
              cardinality:this.cardinality,
              returning:this.returning
            })
          });
          const result = await response.json().catch(()=>null);
          if (!response.ok || !result) {
            const error = result && result.error ? result.error : {message:"Cloudflare D1のチャット処理に失敗しました。",code:"D1_CHAT_FAILED"};
            if (this.throwErrors) throw Object.assign(new Error(error.message || "D1 chat failed"),error);
            return {data:null,error};
          }
          return {data:result.data ?? null,error:null,count:Array.isArray(result.data)?result.data.length:(result.data?1:0)};
        } catch(error) {
          const normalized = {
            message:String(error && error.message || "Cloudflare D1のチャットに接続できません。"),
            code:String(error && error.code || "D1_CHAT_NETWORK_ERROR")
          };
          if (this.throwErrors) throw error;
          return {data:null,error:normalized};
        }
      })();
      return this._promise;
    }
  }

  function install(client) {
    if (!client || typeof client.from !== "function" || client.__kuroD1ChatInstalled) return client;
    const originalFrom = client.from.bind(client);
    client.from = function(table) {
      const name = String(table || "");
      if (CHAT_TABLES.has(name)) return new KuroD1ChatQuery(client,name);
      return originalFrom(table);
    };
    try { Object.defineProperty(client,"__kuroD1ChatInstalled",{value:true,configurable:false}); }
    catch(_) { client.__kuroD1ChatInstalled = true; }
    return client;
  }

  global.KuroD1Chat = Object.freeze({install, isInstalled:client=>!!(client&&client.__kuroD1ChatInstalled)});
})(window);
