import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import NostraSwapFactory from '../../build/NostraSwapFactory.json'
import INostraSwapPair from '../../build/INostraSwapPair.json'

import ExternalNostraSwapFactory from '../../build/ExternalNostraSwapFactory.json'
import ExternalNostraSwapPair from '../../build/ExternalNostraSwapPair.json'

import ERC20 from '../../build/ERC20.json'
import WETH9 from '../../build/WETH9.json'
import NostraSwapRouter from '../../build/NostraSwapRouter.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'

const overrides = {
  gasLimit: 9999999
}

interface V2Fixture {
  token0: Contract
  token1: Contract
  WETH: Contract
  WETHPartner: Contract
  factoryV2: Contract
  router: Contract
  routerEventEmitter: Contract
  pair: Contract
  WETHPair: Contract
}

export async function v2Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<V2Fixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WETH = await deployContract(wallet, WETH9)
  const WETHPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  await WETH.deposit({value: expandTo18Decimals(99999)})

  // deploy V2
  const externalFactory = await deployContract(wallet, ExternalNostraSwapFactory, [wallet.address, wallet.address], overrides)
  const factoryV2 = await deployContract(wallet, NostraSwapFactory, [wallet.address, wallet.address, WETH.address, externalFactory.address], overrides)

  // deploy routers
  const router = await deployContract(wallet, NostraSwapRouter, [factoryV2.address, WETH.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])


  // initialize V2
  await externalFactory.createPair(WETH.address, tokenA.address, overrides)
  let pairAddress = await externalFactory.getPair(WETH.address, tokenA.address)
  let pair = new Contract(pairAddress, JSON.stringify(ExternalNostraSwapPair.abi), provider).connect(wallet)
  
  await tokenA.transfer(pairAddress, 1000000)
  await WETH.transfer(pairAddress, 1000000)
  await pair.mint(wallet.address)

  await externalFactory.createPair(WETH.address, WETHPartner.address, overrides)
  pairAddress = await externalFactory.getPair(WETH.address, WETHPartner.address)
  pair = new Contract(pairAddress, JSON.stringify(ExternalNostraSwapPair.abi), provider).connect(wallet)
  
  await WETHPartner.transfer(pairAddress, 1000000)
  await WETH.transfer(pairAddress, 1000000)
  await pair.mint(wallet.address)


  await factoryV2.createPair(tokenA.address)
  pairAddress = await factoryV2.getPair(tokenA.address, WETH.address)
  pair = new Contract(pairAddress, JSON.stringify(INostraSwapPair.abi), provider).connect(wallet)

  const token0 = WETH
  const token1 = tokenA

  await factoryV2.createPair(WETHPartner.address)
  const WETHPairAddress = await factoryV2.getPair(WETH.address, WETHPartner.address)
  const WETHPair = new Contract(WETHPairAddress, JSON.stringify(INostraSwapPair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    WETH,
    WETHPartner,
    factoryV2,
    router,
    routerEventEmitter,
    pair,
    WETHPair
  }
}