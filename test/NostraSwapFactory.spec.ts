import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero } from 'ethers/constants'
import { bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { getCreate2Address } from './shared/utilities'
import { factoryFixture } from './shared/fixtures'

import NostraSwapPair from '../build/NostraSwapPair.json'

chai.use(solidity)

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

describe('NostraSwapFactory', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, other] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet, other])

  let factory: Contract
  let WETH: Contract
  let tokenA: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(factoryFixture)
    factory = fixture.factory
    WETH = fixture.WETH
    tokenA = fixture.tokenA
  })

  it('feeTo, feeToSetter, allPairsLength', async () => {
    expect(await factory.feeTo()).to.eq(AddressZero)
    expect(await factory.feeToSetter()).to.eq(wallet.address)
    expect(await factory.allPairsLength()).to.eq(0)
  })

  async function createPair(tokens: [string, string]) {
    const bytecode = `0x${NostraSwapPair.evm.bytecode.object}`
    const create2Address = getCreate2Address(factory.address, tokens, bytecode)
    await expect(factory.createPair(tokens[1]))
      .to.emit(factory, 'PairCreated')
      .withArgs(tokens[0], tokens[1], create2Address, bigNumberify(1))

    await expect(factory.createPair(tokens[1])).to.be.reverted // NostraSwap: PAIR_EXISTS
    expect(await factory.getPair(...tokens)).to.eq(create2Address)
    expect(await factory.getPair(...tokens.slice().reverse())).to.eq(create2Address)
    expect(await factory.allPairs(0)).to.eq(create2Address)
    expect(await factory.allPairsLength()).to.eq(1)

    const pair = new Contract(create2Address, JSON.stringify(NostraSwapPair.abi), provider)
    expect(await pair.factory()).to.eq(factory.address)
    expect(await pair.token0()).to.eq(tokens[0])
    expect(await pair.token1()).to.eq(tokens[1])
  }

  it('createPair', async () => {
    await createPair([WETH.address, tokenA.address])
  })

  it('createPair:gas', async () => {
    const tx = await factory.createPair(tokenA.address)
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(3814859)
  })

  it('setFeeTo', async () => {
    await expect(factory.connect(other).setFeeTo(other.address)).to.be.revertedWith('NostraSwap: FORBIDDEN')
    await factory.setFeeTo(wallet.address)
    expect(await factory.feeTo()).to.eq(wallet.address)
  })

  it('setFeeToSetter', async () => {
    await expect(factory.connect(other).setFeeToSetter(other.address)).to.be.revertedWith('NostraSwap: FORBIDDEN')
    await factory.setFeeToSetter(other.address)
    expect(await factory.feeToSetter()).to.eq(other.address)
    await expect(factory.setFeeToSetter(wallet.address)).to.be.revertedWith('NostraSwap: FORBIDDEN')
  })
})
