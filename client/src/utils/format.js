import { getWeb3 } from "../store/metamask";

export const toEther = (wei) => {
  const web3 = getWeb3();
  return web3.utils.fromWei(wei.toString(), "ether");
};

export const toWei = (ether) => {
  const web3 = getWeb3();
  return web3.utils.toWei(ether.toString(), "ether");
};

export const toTwoDec = (bn) => {
  const [main, decimal] = bn.split(".");
  const result = decimal?(main + "." + decimal.substr(0, 2)):main;
  
  return result;
};
