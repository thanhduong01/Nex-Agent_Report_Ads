export const baseVariables = {
  chi_phi: "Chi phí", tin_nhan: "Tin nhắn", so_dien_thoai: "SĐT",
  chi_phi_co_sdt: "Chi phí của sản phẩm có theo dõi SĐT",
  tin_nhan_co_sdt: "Tin nhắn của sản phẩm có theo dõi SĐT",
  hien_thi: "Lượt hiển thị", nhap_lien_ket: "Lượt nhấp liên kết",
  lead: "Lead trên Meta", don_hang: "Đơn hàng", doanh_thu: "Doanh thu",
};
export type FormulaValue = { value: number | null; reason?: string };
export type MetricExpression = { id: string; formula: string };
type Node = { kind:"number"; value:number } | { kind:"variable"; name:string } |
  { kind:"unary"; op:string; value:Node } | { kind:"binary"; op:string; left:Node; right:Node } |
  { kind:"call"; name:string; args:Node[] };
const functions = new Set(["IF","ROUND","ABS","MIN","MAX","SUM","COALESCE"]);
const forbidden = new Set(["constructor","prototype","__proto__","process","globalThis","window","eval","Function"]);
function fail(message: string): never { throw new Error("Công thức: " + message); }
const missing = (reason = "Thiếu số liệu.") : FormulaValue => ({value:null,reason});
const finite = (value: number): FormulaValue => Number.isFinite(value) && Math.abs(value) <= 1e30 ? {value} : missing("Kết quả vượt giới hạn tính toán.");

function parse(expression: string): { tree:Node; names:Set<string> } {
  if(typeof expression !== "string" || !expression.trim() || expression.length > 512) fail("dài tối đa 512 ký tự và không được để trống.");
  const tokens:string[] = [];
  const re=/\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d{1,3})?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|<>|[+\-*/%^(),><=]))/y;
  let offset=0;
  while(offset < expression.length) {
    if(!expression.slice(offset).trim()) break;
    re.lastIndex=offset; const token=re.exec(expression);
    if(!token) fail("ký tự không hợp lệ tại vị trí " + (offset+1) + ".");
    tokens.push(token[1] || token[2] || token[3]); offset=re.lastIndex;
    if(tokens.length > 128) fail("quá nhiều phép tính.");
  }
  let index=0; const names=new Set<string>();
  const precedence:Record<string,number>={"=":1,"==":1,"!=":1,"<>":1,">":1,"<":1,">=":1,"<=":1,"+":2,"-":2,"*":3,"/":3,"%":3,"^":4};
  const expressionAt=(minimum=0,depth=0):Node => {
    if(depth>24) fail("lồng quá sâu.");
    const token=tokens[index++]; let left:Node;
    if(token === "+" || token === "-") left={kind:"unary",op:token,value:expressionAt(4,depth+1)};
    else if(token === "(") {left=expressionAt(0,depth+1);if(tokens[index++]!==")")fail("thiếu dấu đóng ngoặc.");}
    else if(token && /^(?:\d|\.)/.test(token)) {
      const value=Number(token); if(!Number.isFinite(value))fail("số không hợp lệ.");
      left={kind:"number",value};
    } else if(token && /^[A-Za-z_]\w*$/.test(token)) {
      if(forbidden.has(token))fail("tên biến không được phép.");
      if(tokens[index] === "(") {
        const name=token.toUpperCase();if(!functions.has(name))fail("hàm không được hỗ trợ.");
        index++; const args:Node[]=[];
        if(tokens[index]!==")") do {
          if(args.length>=16)fail("hàm nhận tối đa 16 đối số.");
          args.push(expressionAt(0,depth+1));
          if(tokens[index]!==",")break;index++;
        } while(true);
        if(tokens[index++]!==")")fail("thiếu dấu đóng ngoặc hàm.");
        if((name==="IF" && args.length!==3)||(name==="ABS" && args.length!==1)||
          (name==="ROUND" && (args.length<1||args.length>2))||(!args.length))fail("số đối số không đúng.");
        left={kind:"call",name,args};
      } else {names.add(token);left={kind:"variable",name:token};}
    } else fail("thiếu số hoặc biến.");
    while(index<tokens.length && Object.hasOwn(precedence,tokens[index]) && precedence[tokens[index]]>=minimum) {
      const op=tokens[index++], level=precedence[op];
      left={kind:"binary",op,left,right:expressionAt(level+(op==="^"?0:1),depth+1)};
    }
    return left;
  };
  const tree=expressionAt();
  if(index!==tokens.length)fail("thừa ký tự hoặc thiếu phép toán.");
  return {tree,names};
}
function evaluate(tree:Node, resolve:(name:string)=>FormulaValue, budget:{left:number}): FormulaValue {
  if(--budget.left<0)return missing("Vượt giới hạn số phép tính.");
  if(tree.kind==="number")return finite(tree.value);
  if(tree.kind==="variable")return tree.name==="NULL" ? missing() : resolve(tree.name);
  const run=(node:Node)=>evaluate(node,resolve,budget);
  if(tree.kind==="unary") {const result=run(tree.value);return result.value===null?result:finite(tree.op==="-"?-result.value:result.value);}
  if(tree.kind==="call") {
    if(tree.name==="IF") {const test=run(tree.args[0]);return test.value===null?test:run(tree.args[test.value?1:2]);}
    if(tree.name==="COALESCE") {for(const node of tree.args){const result=run(node);if(result.value!==null)return result;}return missing();}
    const args=tree.args.map(run), empty=args.find(x=>x.value===null);
    if(empty)return empty;
    const values=args.map(x=>x.value!);
    switch(tree.name) {
      case "ABS":return finite(Math.abs(values[0]));
      case "MIN":return finite(Math.min(...values));
      case "MAX":return finite(Math.max(...values));
      case "SUM":return finite(values.reduce((a,b)=>a+b,0));
      case "ROUND": {
        const digits=values[1]??0;
        if(!Number.isInteger(digits)||Math.abs(digits)>10)return missing("Số chữ số làm tròn phải từ -10 đến 10.");
        const scale=10**digits;return finite(Math.round((values[0]+Number.EPSILON)*scale)/scale);
      }
    }
    return missing();
  }
  const left=run(tree.left),right=run(tree.right);
  if(left.value===null||right.value===null)return left.value===null?left:right;
  const a=left.value,b=right.value;
  if((tree.op==="/"||tree.op==="%")&&b===0)return missing("Mẫu số bằng 0.");
  switch(tree.op) {
    case "+":return finite(a+b);case "-":return finite(a-b);case "*":return finite(a*b);
    case "/":return finite(a/b);case "%":return finite(a%b);case "^":return finite(a**b);
    case "=":case "==":return {value:Number(a===b)};case "!=":case "<>":return {value:Number(a!==b)};
    case ">":return {value:Number(a>b)};case "<":return {value:Number(a<b)};
    case ">=":return {value:Number(a>=b)};case "<=":return {value:Number(a<=b)};
    default:return missing();
  }
}
export function calculateFormula(expression:string, values:Record<string,number|null>): FormulaValue {
  const parsed=parse(expression);
  return evaluate(parsed.tree,name=>Object.hasOwn(values,name) && typeof values[name]==="number" ?
    finite(values[name]!) : missing("Thiếu số liệu: " + name + "."),{left:2048});
}
export function validateMetrics(definitions:MetricExpression[], constants:string[] = []) {
  if(definitions.length>40)fail("tối đa 40 chỉ số.");
  const allowed=new Set([...Object.keys(baseVariables),...constants,"NULL"]);
  const trees=new Map<string,ReturnType<typeof parse>>();
  for(const definition of definitions) {
    if(!/^[a-z][a-z0-9_]{0,47}$/.test(definition.id)||forbidden.has(definition.id))fail("mã chỉ số chưa hợp lệ.");
    if(allowed.has(definition.id)||trees.has(definition.id))fail("mã chỉ số trùng biến hoặc chỉ số khác.");
    trees.set(definition.id,parse(definition.formula));
  }
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(name:string,depth=0) => {
    if(depth>40||visiting.has(name))fail("các chỉ số tham chiếu vòng.");
    if(done.has(name)||allowed.has(name))return;
    const parsed=trees.get(name);if(!parsed)fail("biến " + name + " không tồn tại.");
    visiting.add(name);for(const dependency of parsed.names)visit(dependency,depth+1);
    visiting.delete(name);done.add(name);
  };
  for(const name of trees.keys())visit(name);
}
export function evaluateMetrics(definitions:MetricExpression[], values:Record<string,number|null>):Record<string,FormulaValue> {
  validateMetrics(definitions,Object.keys(values).filter(key=>!Object.hasOwn(baseVariables,key)));
  const trees=new Map(definitions.map(metric=>[metric.id,parse(metric.formula).tree]));
  const results:Record<string,FormulaValue>=Object.create(null);
  const budget={left:12000};
  const resolve=(name:string):FormulaValue => {
    if(Object.hasOwn(results,name))return results[name];
    const tree=trees.get(name);
    if(tree)return results[name]=evaluate(tree,resolve,budget);
    return Object.hasOwn(values,name)&&typeof values[name]==="number"?finite(values[name]!):missing("Thiếu số liệu: "+name+".");
  };
  for(const metric of definitions)resolve(metric.id);
  return results;
}
