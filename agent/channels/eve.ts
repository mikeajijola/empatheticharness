import { eveChannel } from "eve/channels/eve";
import { operatorAuth } from "../lib/auth";
export default eveChannel({ auth: operatorAuth });
